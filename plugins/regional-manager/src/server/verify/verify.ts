// The verify step: the plugin, not the regional manager, starts a verifier for every check of a done
// handoff while verification is on, and the handoff reaches the regional manager only with its
// verdict. A returned verdict is stored first, then settled: one that passed every criterion waits
// while CI on its commit is still to come, an agent's first failed verdict goes back to the agent,
// as the verifier's message, with no turn of the regional manager, and any other goes to the
// regional manager. Every change to a verdict is a compare-and-set in the store, so the handoff
// tool, the verifier's issue_verdict and the tick can race without a verdict moving twice.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { branchOf, type Agent } from "../../model/agent.ts";
import { sameModel, type Execution } from "../../model/execution.ts";
import { handoffIsCurrent, type GivenHandoff, type Handoff } from "../../model/handoff.ts";
import type { Check, CheckId } from "../../model/verdict/check.ts";
import type { CheckoutRead } from "../../model/verdict/checkout.ts";
import { ciOf, type CiVerdict } from "../../model/verdict/pr.ts";
import { isSettled, judge, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";
import { environmentGone, type EnvironmentsBb } from "../agents/environments.ts";
import { latestTurnSeq, listedThreads, stoppedTurn, threadsById, type StopBb, type TurnsBb } from "../agents/threads.ts";
import type { CatalogBb } from "../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { IssueTurns, Turn } from "../issues/issue-turns.ts";
import type { Spawner, VerifierRequest } from "../spawn.ts";
import type { OpenCheck, Settlement } from "../store/issue/checks-store.ts";
import type { Store } from "../store/store.ts";
import { findingsMessage } from "./findings.ts";
import { refusalOf } from "./send-refusal.ts";
import { verifierExecution } from "./verifier-model.ts";
import { verifierBrief } from "./verifier-brief.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type ThreadRow = Awaited<ReturnType<Threads["list"]>>[number];

/** A thread as the verify step lists it. */
type ListedThread = Pick<ThreadRow, "id" | "providerId" | "environmentId" | "environmentBranchName" | "status" | "archivedAt" | "deletedAt">;

/** The parts of bb the verify step uses, down to the fields it reads. */
type VerifyBb = CatalogBb &
  TurnsBb &
  ThreadExecutionBb &
  EnvironmentsBb & {
    log: Pick<PluginLogger, "warn">;
    onDispose(hook: () => void): void;
    sdk: {
      threads: {
        list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]>;
        send(args: Parameters<Threads["send"]>[0]): Promise<unknown>;
        stop(args: { threadId: string }): Promise<unknown>;
      };
    };
  };

type Deps = {
  bb: VerifyBb;
  store: Pick<Store, "check" | "handoff" | "agent" | "issue" | "coordinator" | "openChecks" | "markNudged" | "receiveVerdict" | "claimFixRound" | "unsettledChecks" | "prOfBranch">;
  spawner: Pick<Spawner, "verifier">;
  inbox: Pick<Inbox, "handoff" | "giveUpCheck" | "settleCheck">;
  turns: IssueTurns;
};

/** A verifier's report on the claimed commit `headSha`, each criterion named by its text. */
export type VerifierReport = Pick<Extract<Verdict, { state: "returned" }>, "headSha" | "findings"> & { criteria: { criterion: string; result: CriterionResult; evidence: string }[] };

type Running = Extract<Verdict, { state: "running" }>;
type Returned = Extract<Verdict, { state: "returned" }>;

/** What settling a returned verdict does next: send its findings to the agent, wait for CI, or settle it as it is. */
type Step = { kind: "send"; ci: CiVerdict } | Exclude<Settlement, { kind: "sent-back" }>;

/** What a verdict that settles before CI finished on its commit says of CI: it failed on its criteria first. */
const CI_UNFINISHED: CiVerdict = { kind: "not-checked", reason: "CI hadn't finished when its criteria failed" };

/** How many failed verdicts go back to an agent before the next one goes to its regional manager. */
const MAX_AUTO_FIX_ROUNDS = 1;

const NUDGE =
  "You ended your turn without calling issue_verdict, so nobody has your verdict. Finish checking each done-criterion and call issue_verdict once; it is the only way your verdict reaches anyone.";

export type Verify = ReturnType<typeof createVerify>;

export function createVerify({ bb, store, spawner, inbox, turns }: Deps) {
  // why: the handoff tool and the tick can both find a check queued; one spawn is enough.
  const starting = new Set<CheckId>();
  // why: issue_verdict and the tick can both settle a verdict, and its findings must reach the agent once.
  const settling = new Set<CheckId>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /** The agent whose done handoff the check judges. why throw: a check is made of an agent's handoff, and agents are never deleted while their regional manager is kept. */
  function agentOf(check: Check): Agent & { threadId: string } {
    const agent = store.agent(check.coordinatorId, check.subject.agentId);
    if (agent === null || agent.threadId === null) throw new Error(`The agent ${check.subject.agentId} of ${check.coordinatorId} has no thread.`);
    return { ...agent, threadId: agent.threadId };
  }

  /** Everything a verifier for this check needs, or null once its verdict is no longer queued. */
  async function requestFor(checkId: CheckId): Promise<VerifierRequest | null> {
    const check = store.check(checkId);
    if (check?.verdict.state !== "queued") return null;
    const { checkout } = check.verdict;
    const agent = agentOf(check);
    const coordinator = store.coordinator(check.coordinatorId);
    const issue = store.issue(check.coordinatorId, check.issueId);
    // why throw: a check is made of a bound agent's handoff, on an issue that had a brief for it to start.
    if (coordinator === null || issue === null || issue.brief === null) throw new Error(`The issue ${check.issueId} of ${check.coordinatorId} is missing its regional manager or its brief.`);
    const thread = (await listedThreads(bb, [agent.threadId])).get(agent.threadId);
    if (thread === undefined) throw new Error("the agent's thread was archived or deleted");
    if (thread.environmentId === null) throw new Error("the agent's thread has no environment to check");
    const execution = await verifierExecution(bb, {
      named: check.verifier,
      manager: await threadExecution(bb, coordinator.threadId),
      theirs: [agent.execution],
      routing: { environmentId: thread.environmentId },
    });
    return {
      role: { kind: "verifier", coordinatorId: coordinator.id, issueId: issue.id, checkId },
      coordinator,
      parentThreadId: agent.threadId,
      title: `Verify ${issue.id}: ${issue.title}`,
      environment: { type: "reuse", environmentId: thread.environmentId },
      execution,
      prompt: verifierBrief({ ...issue, brief: issue.brief }, check, checkout),
    };
  }

  /**
   * Starts the check's verifier if it is still queued once it holds its issue's turn, so a handover
   * that superseded it meanwhile starts none; one that can't start is recorded as could-not-run.
   */
  async function start(checkId: CheckId): Promise<void> {
    const check = store.check(checkId);
    if (disposed || check === null || starting.has(checkId)) return;
    starting.add(checkId);
    try {
      await turns.run(check.coordinatorId, check.issueId, async (turn) => {
        const request = await requestFor(checkId);
        if (request === null || disposed) return;
        turn.check();
        await spawner.verifier(request);
      });
    } catch (error) {
      // why only from queued: bb may have made the thread and bound it through thread.created, with only its answer lost.
      inbox.giveUpCheck(checkId, { state: "queued" }, { state: "could-not-run", verifierThreadId: null, reason: `bb did not start a verifier: ${messageOf(error)}` });
    } finally {
      starting.delete(checkId);
    }
  }

  /**
   * A running check on the tick: a verifier that is gone, or idle without a verdict, is nudged
   * once, then given up on. One whose environment bb destroyed is given up on at once, since a
   * reminder can't run there.
   */
  async function follow(check: OpenCheck & { verdict: Running }, thread: ListedThread | null): Promise<void> {
    // why in its issue's turn: a handover that supersedes the check meanwhile stops its verifier, and a nudge after that would wake it.
    await turns.run(check.coordinatorId, check.issueId, (turn) => nudgeOrGiveUp(check.id, check.verdict, thread, turn));
  }

  async function nudgeOrGiveUp(checkId: CheckId, verdict: Running, thread: ListedThread | null, turn: Turn): Promise<void> {
    const from = { state: "running", verifierThreadId: verdict.verifierThreadId } as const;
    const giveUp = (reason: string) => inbox.giveUpCheck(checkId, from, { state: "could-not-run", verifierThreadId: verdict.verifierThreadId, reason });
    if (thread === null) return void giveUp("its verifier thread was archived or deleted before it returned a verdict");
    if (thread.status !== "idle" && thread.status !== "error") return;
    const destroyed = thread.environmentId !== null && (await environmentGone(bb, thread.environmentId));
    // why: a reload during the read has a new instance follow this check.
    if (disposed) return;
    if (destroyed) return void giveUp("the agent's environment was removed (a sandbox removed or reaped) before its verifier returned a verdict");
    if (verdict.nudged) return void giveUp("its verifier stopped without a verdict twice, the second time after a reminder");
    turn.check();
    // why mark first: a nudge sent twice would double the verifier's work; a lost one only ends it sooner.
    if (!store.markNudged(checkId, verdict.verifierThreadId)) return;
    try {
      await bb.sdk.threads.send({ threadId: thread.id, mode: "queue-if-active", input: [{ type: "text", text: NUDGE, mentions: [] }] });
    } catch (error) {
      bb.log.warn(`Could not remind the verifier ${thread.id} to return its verdict: ${messageOf(error)}`);
    }
  }

  /** The check, the handoff it judges, its agent and its returned verdict, while that verdict is not settled; else null. */
  function unsettledOf(checkId: CheckId): { check: Check; handoff: Handoff; agent: Agent & { threadId: string }; verdict: Returned } | null {
    const check = store.check(checkId);
    if (check?.verdict.state !== "returned" || isSettled(check.verdict)) return null;
    const handed = store.handoff(check.subject.handoffId);
    // why throw: a check is inserted with its handoff, in one transaction.
    if (handed === null) throw new Error(`The handoff of check ${checkId} is missing.`);
    return { check, handoff: handed.handoff, agent: agentOf(check), verdict: check.verdict };
  }

  /**
   * The next step for an unsettled verdict (`current`: its handoff is still current in its agent's
   * thread, which bb still has; `thread`: that thread, as bb lists it), judged with CI on its commit
   * as the PR status of the agent's branch says, the branch the PR watch reads. One that passed every
   * criterion waits while CI is still to come. A failed one is sent back when its handoff is current,
   * the agent still holds its issue with a round left and its pull request hasn't merged (a merge
   * made the issue Done); else it is checked. One whose round is claimed was being sent when the
   * plugin stopped, as settle owns a claim until it settles it. Its findings may or may not have
   * reached the agent, and nothing bb keeps can tell: a send's pluginSubmission is never stored, and
   * a turn in the agent's thread may be anyone's. So it goes to the regional manager, with the round
   * kept, and is never sent again.
   */
  function stepOf({ check, agent, verdict }: NonNullable<ReturnType<typeof unsettledOf>>, current: boolean, thread: ListedThread | null): Step {
    if (verdict.settlement.kind === "sending-back") return { kind: "maybe-sent-back" };
    const { subject } = check;
    const branch = branchOf(agent, thread);
    const status = branch === null ? null : store.prOfBranch(check.coordinatorId, branch);
    const ci = ciOf({ id: subject.handoffId, headSha: subject.headSha, prUrl: subject.prUrl }, status);
    const judged = judge(verdict, ci);
    if (judged === "waiting-for-ci") return { kind: "waiting-for-ci" };
    const settledCi = ci.kind === "waiting" ? CI_UNFINISHED : ci;
    const merged = status?.snapshot?.state === "merged";
    const send = judged === "fail" && !merged && current && agent.ended === null && agent.fixRounds < MAX_AUTO_FIX_ROUNDS;
    return send ? { kind: "send", ci: settledCi } : { kind: "checked", refused: null, ci: settledCi };
  }

  /**
   * Settles a returned verdict: a failed one's findings go back to its agent while it has a round
   * left, anything else goes to the regional manager as checked. Its issue says Verifying until
   * then. Safe to run again at any point, as the tick does after a crash or a reload: the round is
   * claimed in the store before the findings leave, and each step moves the verdict on only from
   * where it was. A claim a crash or reload left behind goes to the regional manager, which is told
   * the findings may or may not have reached the agent (see stepOf). The round comes back only when
   * bb refused the findings (see sendBack).
   */
  async function settle(checkId: CheckId): Promise<void> {
    const check = store.check(checkId);
    if (disposed || check === null || settling.has(checkId)) return;
    settling.add(checkId);
    try {
      // why in its issue's turn: a handover waits for findings on their way to finish, and stops the agent after them; findings that wait for it find their agent replaced, and go to the regional manager.
      await turns.run(check.coordinatorId, check.issueId, (turn) => settleInTurn(checkId, turn));
    } finally {
      settling.delete(checkId);
    }
  }

  async function settleInTurn(checkId: CheckId, turn: Turn): Promise<void> {
    const agent = unsettledOf(checkId)?.agent;
    if (agent === undefined) return;
    const thread = (await threadsById(bb, [agent.threadId])).get(agent.threadId) ?? null;
    // why only a holding agent's thread bb still has: bb answers 404 for a deleted thread's turns, and an ended agent is sent nothing.
    const sendable = agent.ended === null && thread !== null && thread.deletedAt === null;
    // why read bb first and the store right after, with no await before deciding: a turn the
    // agent starts after this read starts after the decision too.
    const latest = sendable ? await latestTurnSeq(bb, agent.threadId) : null;
    const unsettled = unsettledOf(checkId);
    if (unsettled === null || disposed) return;
    const step = stepOf(unsettled, sendable && handoffIsCurrent(unsettled.handoff, latest), thread);
    turn.check();
    if (step.kind !== "send") return inbox.settleCheck(checkId, step);
    store.claimFixRound(checkId, step.ci);
    // why settle whatever happened meanwhile: the claim, not the verdict's old state, says the findings are owed.
    inbox.settleCheck(checkId, await sendBack(unsettled.agent, unsettled.verdict, step.ci));
  }

  /**
   * Sends a failed verdict's findings to the agent's thread as its verifier's message, so bb marks
   * them as another thread's, never the user's; says how the verdict settles. Taken: sent back.
   * Refused, as only some of bb's answers prove: checked, with bb's answer. Any other failure may
   * come after bb took them, so they may or may not have reached the agent.
   */
  async function sendBack(agent: Agent & { threadId: string }, verdict: Returned, ci: CiVerdict): Promise<Settlement> {
    try {
      await bb.sdk.threads.send({
        threadId: agent.threadId,
        senderThreadId: verdict.verifierThreadId,
        mode: "queue-if-active",
        input: [{ type: "text", text: findingsMessage(verdict, ci), mentions: [] }],
      });
      return { kind: "sent-back" };
    } catch (error) {
      bb.log.warn(`Could not send the verifier's findings to ${agent.id} (${agent.threadId}), so its regional manager decides: ${messageOf(error)}`);
      const refused = refusalOf(error);
      return refused === null ? { kind: "maybe-sent-back" } : { kind: "checked", refused, ci };
    }
  }

  return {
    /**
     * Stores an agent's handoff with `checkout`, its environment as read as it handed off, stops the
     * verifiers of the earlier checks it supersedes, and starts its own when its check is queued for
     * one. Returns its check (null: not done).
     */
    async handoff(handoff: GivenHandoff, checkout: CheckoutRead): Promise<Check | null> {
      const { check, superseded } = inbox.handoff(handoff, checkout);
      const unstopped = await turns.run(handoff.coordinatorId, handoff.issueId, () => stopVerifiers(bb, superseded));
      for (const { threadId, why } of unstopped) bb.log.warn(`The superseded verifier ${threadId} ${why}; its verdict will be refused.`);
      if (check?.verdict.state === "queued") await start(check.id);
      return check;
    },

    /**
     * Stores a verifier's verdict on the check it runs, with the model bb ran it on and whether that
     * is the model of the agent whose work it checks, as stored when it handed off, if it is still
     * that check's running verifier, then settles it; says whether it was.
     */
    async returned(checkId: CheckId, verifierThreadId: string, theirs: readonly Execution[], report: VerifierReport): Promise<boolean> {
      const ran = await threadExecution(bb, verifierThreadId);
      // why throw: the verifier calls issue_verdict from inside a turn, so bb has its model on record.
      if (ran === null) throw new Error(`bb has no model on record for ${verifierThreadId}.`);
      const model = { providerId: ran.providerId, model: ran.model };
      if (!store.receiveVerdict(checkId, { state: "returned", verifierThreadId, ...report, model, sameModel: theirs.some((their) => sameModel(model, their)) })) return false;
      // why not fail the verdict: it is stored, and the tick settles it.
      await settle(checkId).catch((error: unknown) => bb.log.warn(`Could not settle the verdict of check ${checkId} yet; the next tick tries again: ${messageOf(error)}`));
      return true;
    },

    /**
     * The tick's pass, after the PR watch's reads: starts every verifier still queued, follows every
     * one still running, and settles every verdict that waits for CI or that a crash or a reload
     * left unsettled. why one read per check, right before acting on it: the pass awaits bb between
     * them.
     */
    async reconcile(): Promise<void> {
      for (const check of store.openChecks() satisfies OpenCheck[]) {
        if (disposed) return;
        const { verdict } = check;
        if (verdict.state === "queued") {
          await start(check.id);
          continue;
        }
        const thread = (await listedThreads(bb, [verdict.verifierThreadId])).get(verdict.verifierThreadId) ?? null;
        if (!disposed) await follow({ ...check, verdict }, thread);
      }
      for (const checkId of store.unsettledChecks()) {
        if (disposed) return;
        await settle(checkId);
      }
    },
  };
}

/** A verifier bb hasn't confirmed stopped, and why: the status bb still reports, or its refusal of the stop. */
export type Unstopped = { threadId: string; why: string };

/**
 * Stops the verifiers and confirms each stopped, never archiving them: a verifier lives in its
 * agent's environment, and archiving a sandbox's last live thread destroys it (SH5). Returns every
 * one bb hasn't confirmed stopped.
 */
export async function stopVerifiers(bb: StopBb, threadIds: readonly string[]): Promise<Unstopped[]> {
  const stops = await Promise.all(
    threadIds.map(async (threadId): Promise<Unstopped[]> => {
      try {
        const status = await stoppedTurn(bb, threadId);
        return status === null ? [] : [{ threadId, why: `is still ${status}` }];
      } catch (error) {
        return [{ threadId, why: `wasn't stopped: bb answered ${messageOf(error)}` }];
      }
    }),
  );
  return stops.flat();
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
