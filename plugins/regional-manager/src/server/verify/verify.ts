// The verify step: the plugin, not the regional manager, starts a verifier for every check of a done
// handoff, and for a build parent's final check (final-check/), while verification is on, and the
// handoff reaches the regional manager only with its verdict. A done handoff's verifier starts once
// its review is in, or was missed (review/): the reviewer takes the environment first, the same way. A returned verdict is stored first, then settled: one that passed all but CI waits
// while CI on its commit is still to come, an agent's first failed verdict goes back to the agent,
// as the verifier's message, with no turn of the regional manager, and any other goes to the
// regional manager. The handoff tool, the verifier's issue_verdict, the tick and an issue's thread
// going idle each act in the issue's turn (issue-turns.ts), reading the check once they hold it;
// every change to a verdict is still a compare-and-set in the store, so a reload mid-turn can't move
// one twice.
//
// An agent and its own verifier share an environment, and never run at the same time: a verifier
// starts, or is reminded, only while bb reports its agent's thread idle, and findings go back only
// once bb reports the verifier's no longer running. Each time the environment changes hands, as a
// verifier starts, as one is reminded and as findings go back, the issue's other threads are
// quieted first (see quietIssue): what the plugin queued for them taken back, each stopped whatever
// bb reports, as a thread bb reports idle can still hold a background command whose finish wakes
// it, and each confirmed stopped. bb saying a thread went idle is only the trigger to look again
// (lookAgain), and the tick looks again for anything missed. A final check's verifier has a worktree of its own and
// checks no agent's handoff, so nothing waits for it.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { branchOf, type Agent, type AgentCheckout, type EndedHow } from "../../model/agent/agent.ts";
import { sameModel, type Execution } from "../../model/agent/execution.ts";
import { handoffIsCurrent, type GivenHandoff, type Handoff } from "../../model/agent/handoff.ts";
import type { Coordinator } from "../../contract.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { checkedAgents, type Check, type CheckId, type HandoffCheck } from "../../model/verdict/check.ts";
import { isReviewing, reviewPending } from "../../model/verdict/review.ts";
import type { Checkout, CheckoutRead } from "../../model/verdict/checkout.ts";
import { ciOf, type CiVerdict } from "../../model/verdict/pr.ts";
import { capQuestionsOf, countedFailures, mayGoBack } from "../../model/verdict/rounds/cap.ts";
import { isSettled, judge, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";
import { environmentGone, type EnvironmentsBb } from "../agents/environments.ts";
import { handingAgent } from "../agents/handing-agent.ts";
import { isRunning, latestTurnSeq, listedThreads, stopThreads, threadsById, type TurnsBb } from "../agents/threads.ts";
import type { CatalogBb } from "../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import { quietIssue, unquietText, type GivenTo, type QuietBb } from "../issues/quiet.ts";
import type { Review } from "../review/review.ts";
import type { Spawner, CheckerRequest } from "../spawn.ts";
import type { ReceivedVerdict, Settlement } from "../store/issue/checks-store.ts";
import type { Store } from "../store/store.ts";
import { finalCheckerRequest, judgedTree, type FinalVerifierBb } from "./final-check/final-verifier.ts";
import { findingsMessage } from "./findings.ts";
import { refusalOf } from "./send-refusal.ts";
import type { AsksBb } from "../hidden/asks.ts";
import { watchHidden, type ActivityBb } from "../hidden/watch.ts";
import { verifierExecution } from "./verifier-model.ts";
import { checkedIssue, earlierDefectsOf, scopeOf } from "../review/checker-brief.ts";
import { verifierBrief } from "./verifier-brief.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type ThreadRow = Awaited<ReturnType<Threads["list"]>>[number];

/** A thread as the verify step lists it. */
type ListedThread = Pick<
  ThreadRow,
  "id" | "providerId" | "environmentId" | "environmentBranchName" | "environmentHostId" | "status" | "hasPendingInteraction" | "createdAt" | "archivedAt" | "deletedAt"
>;

/** The parts of bb the verify step uses, down to the fields it reads. */
type VerifyBb = CatalogBb &
  TurnsBb &
  ThreadExecutionBb &
  EnvironmentsBb &
  FinalVerifierBb &
  QuietBb &
  AsksBb &
  ActivityBb & {
    log: Pick<PluginLogger, "warn">;
    sdk: {
      threads: {
        list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]>;
        send(args: Parameters<Threads["send"]>[0]): Promise<unknown>;
      };
    };
  };

type Deps = {
  bb: VerifyBb;
  store: Pick<
    Store,
    | "check"
    | "handoff"
    | "agent"
    | "agents"
    | "issue"
    | "coordinator"
    | "issueThreads"
    | "roleOfThread"
    | "recordCheckout"
    | "recordExecution"
    | "openChecks"
    | "markNudged"
    | "recordDeclined"
    | "receiveVerdict"
    | "claimFixRound"
    | "unsettledChecks"
    | "prOfBranch"
    | "record"
    | "decisions"
    | "issueDecisions"
    | "finalChecks"
  >;
  spawner: Pick<Spawner, "checker">;
  review: Pick<Review, "start" | "follow">;
  inbox: Pick<Inbox, "handoff" | "giveUpCheck" | "settleCheck">;
  turns: IssueTurns;
  now(): number;
};

/** A verifier's report: each criterion named by its text, its findings, and its triage of the review's findings, in their order. */
export type VerifierReport = Pick<ReceivedVerdict, "findings" | "blocking" | "triage"> & { criteria: { criterion: string; result: CriterionResult; evidence: string }[] };

/** What became of a verifier's report: stored; refused, as its check no longer waits for it; or, for a final check, why its worktree couldn't be read, which ended the check as could-not-run. */
type Received = "recorded" | "not-running" | { unread: string };

/**
 * An agent's handoff as its tool made it, before it waits for its issue's turn: the handoff and the
 * plugin's read of its checkout; where its work is as seen and what it ran on, to record on the
 * agent (null: not read).
 */
type Handing = { handoff: GivenHandoff; checkout: CheckoutRead; seen: AgentCheckout | null; execution: Execution | null };

type Returned = Extract<Verdict, { state: "returned" }>;
type Running = Extract<Verdict, { state: "running" }>;

/** What settling a returned verdict does next: send its findings to the agent, wait for CI, or settle it as it is. */
type Step = { kind: "send"; ci: CiVerdict } | Exclude<Settlement, { kind: "sent-back" }>;

/**
 * Who settles a returned verdict: its verifier, from inside issue_verdict, whose turn runs until the
 * tool returns and which bb can't stop under its own call; or a look again (the tick, or a thread
 * of the issue going idle), which can stop it.
 */
type Settler = "verdict-tool" | "look";

/** How a final check's returned verdict settles: final at once, with no fix round and no pull request to wait for. Its fix is a new sub-issue. */
const FINAL_SETTLED: Settlement = { kind: "checked", refused: null, ci: { kind: "none" } };

/** What a verdict that settles before CI finished on its commit says of CI: it failed first, on its criteria, its checkout or a must-fix finding. */
const CI_UNFINISHED: CiVerdict = { kind: "not-checked", reason: "CI hadn't finished when the verdict failed" };

/** How many failed verdicts go back to an agent before the next one goes to its regional manager. */
const MAX_AUTO_FIX_ROUNDS = 1;

const NUDGE =
  "Your turn ended and no verdict was recorded, so nobody has your verdict. Finish checking each done-criterion and call issue_verdict; if it was refused for what you passed, correct that and call it again. It is the only way your verdict reaches anyone.";

export type Verify = ReturnType<typeof createVerify>;

export function createVerify({ bb, store, spawner, review, inbox, turns, now }: Deps) {
  /** The agent whose done handoff the check judges (see handingAgent). */
  const agentOf = (check: HandoffCheck): Agent & { threadId: string } => handingAgent(store, check);

  /** A regional manager's thread. why throw: checks are kept while their regional manager is. */
  function managerThreadOf(coordinatorId: CoordinatorId): string {
    const coordinator = store.coordinator(coordinatorId);
    if (coordinator === null) throw new Error(`The regional manager ${coordinatorId} is missing.`);
    return coordinator.threadId;
  }

  /** The check. why throw: callers hold a check id the store gave them, and checks are kept while their regional manager is. */
  function checkOf(checkId: CheckId): Check {
    const check = store.check(checkId);
    if (check === null) throw new Error(`The check ${checkId} is missing.`);
    return check;
  }

  /** Everything a verifier for this check needs, by what it judges; null while none starts now: its verdict is no longer queued, its review is still to come, or its agent still runs (see handoffRequest). */
  async function requestFor(checkId: CheckId): Promise<CheckerRequest | null> {
    const check = store.check(checkId);
    // why not while its review is to come: the reviewer has the environment first (reviewInTurn).
    if (check?.verdict.state !== "queued" || isReviewing(check.review)) return null;
    const coordinator = store.coordinator(check.coordinatorId);
    const issue = store.issue(check.coordinatorId, check.issueId);
    // why throw: checks are kept while their issue and regional manager are.
    if (coordinator === null || issue === null) throw new Error(`The issue ${check.issueId} of ${check.coordinatorId} or its regional manager is missing.`);
    const { subject } = check;
    switch (subject.kind) {
      case "handoff":
        return handoffRequest({ ...check, subject }, coordinator, check.verdict.checkout);
      case "final": {
        const theirs = checkedAgents(check, store.agents(check.coordinatorId)).map(({ execution }) => execution);
        return finalCheckerRequest(bb, { check: { ...check, subject }, coordinator, issue, theirs });
      }
      default:
        return subject satisfies never;
    }
  }

  /**
   * A handoff's verifier: a child of the agent's thread, in the agent's environment, on the checkout
   * read as it handed off; null while bb reports the agent's thread running, as it does through the
   * turn that handed off, so the verifier never runs beside it there.
   */
  async function handoffRequest(check: HandoffCheck, coordinator: Coordinator, checkout: Checkout | null): Promise<CheckerRequest | null> {
    const agent = agentOf(check);
    // why throw: a check is made of a bound agent's handoff, queued with the read made as it handed off.
    if (checkout === null) throw new Error(`The check ${check.id} of ${check.issueId} has no checkout to verify.`);
    const thread = (await listedThreads(bb, [agent.threadId])).get(agent.threadId);
    if (thread === undefined) throw new Error("the agent's thread was archived or deleted");
    if (isRunning(thread)) return null;
    if (thread.environmentId === null) throw new Error("the agent's thread has no environment to check");
    const execution = await verifierExecution(bb, {
      named: check.verifier,
      manager: await threadExecution(bb, coordinator.threadId),
      theirs: [agent.execution],
      routing: { environmentId: thread.environmentId },
    });
    // why read here, after every await: the brief and the decisions it gives must agree (checkedIssue).
    const issue = checkedIssue(store, coordinator.id, check.issueId);
    return {
      role: { kind: "verifier", coordinatorId: coordinator.id, issueId: issue.id, checkId: check.id },
      coordinator,
      parentThreadId: agent.threadId,
      title: `Verify ${issue.id}: ${issue.title}`,
      environment: { type: "reuse", environmentId: thread.environmentId },
      execution,
      prompt: verifierBrief(issue, check, checkout, scopeOf(store, check), earlierDefectsOf(store, check)),
    };
  }

  /**
   * In its issue's turn: once bb reports idle the agent whose handoff the check judges, quiets the
   * issue for the verifier (see quietIssue), that agent and every other verifier, a superseded
   * check's included, then starts the check's verifier while it is queued. While the issue isn't
   * quiet, as while the agent is still to get a message bb queued for it, it starts none, and the
   * next look or tick tries again; one bb won't start is recorded as could-not-run. Stopping the
   * idle agent ends no turn and starts none, so its done handoff stays current: nothing reads it as
   * stopped without one.
   */
  async function startInTurn(check: Check): Promise<void> {
    const { id } = check;
    if (await agentRuns(check)) return;
    if (!(await quietFor(check, { kind: "thread", threadId: null }, "no verifier starts there yet"))) return;
    try {
      const request = await requestFor(id);
      if (request === null) return;
      await spawner.checker(request);
    } catch (error) {
      // why only from queued: bb may have made the thread and bound it through thread.created, with only its answer lost.
      inbox.giveUpCheck(id, { state: "queued" }, { verifierThreadId: null, reason: `bb did not start a verifier: ${messageOf(error)}` }, now());
    }
  }

  /**
   * In its issue's turn: a running check whose verifier is gone, or idle without a verdict, is
   * nudged once, then given up on. One whose verifier runs is watched (see watchRunning). One whose environment bb destroyed is given up on at once, since
   * a reminder can't run there. Reads the check and its verifier as it decides. The reminder gives
   * the environment back to the verifier, so it waits while bb reports the agent whose handoff it
   * checks running, as when someone woke it, and then while the issue's other threads aren't quiet
   * for it (see quietIssue); it comes at a later look once they are.
   */
  async function followInTurn(checkId: CheckId): Promise<void> {
    const { verdict, coordinatorId } = checkOf(checkId);
    if (verdict.state !== "running") return;
    const { verifierThreadId } = verdict;
    const from = { state: "running", verifierThreadId } as const;
    const giveUp = (reason: string) => inbox.giveUpCheck(checkId, from, { verifierThreadId, reason }, now());
    const thread = (await listedThreads(bb, [verifierThreadId])).get(verifierThreadId) ?? null;
    if (thread === null) return void giveUp("its verifier thread was archived or deleted before it returned a verdict");
    if (isRunning(thread)) return watchRunning(checkId, verdict, thread, giveUp);
    const destroyed = thread.environmentId !== null && (await environmentGone(bb, thread.environmentId));
    if (destroyed) return void giveUp("its environment was removed (a sandbox removed or reaped) before its verifier returned a verdict");
    if (verdict.nudged) return void giveUp("its verifier stopped without a verdict twice, the second time after a reminder");
    const check = checkOf(checkId);
    if (await agentRuns(check)) return;
    if (!(await quietFor(check, { kind: "thread", threadId: verifierThreadId }, "its verifier isn't reminded yet"))) return;
    // why from the regional manager's thread: quieting takes back what the plugin queued by its
    // sender, and a reminder bb queued behind a turn would otherwise wake its verifier later.
    const managerThreadId = managerThreadOf(coordinatorId);
    // why mark first: a nudge sent twice would double the verifier's work; a lost one only ends it
    // sooner. One taken back from bb's queue is unmarked (see quietIssue).
    if (!store.markNudged(checkId, verifierThreadId, true)) return;
    try {
      await bb.sdk.threads.send({ threadId: thread.id, senderThreadId: managerThreadId, mode: "queue-if-active", input: [{ type: "text", text: NUDGE, mentions: [] }] });
    } catch (error) {
      bb.log.warn(`Could not remind the verifier ${thread.id} to return its verdict: ${messageOf(error)}`);
    }
  }

  /**
   * In its issue's turn: a running verifier nobody but the plugin watches (see watchHidden).
   * Whatever its provider asks a person is declined and kept on the check for its verdict to name;
   * an ask bb won't let the plugin decline, or no activity for STALL_MS, ends the check and stops it.
   */
  async function watchRunning(checkId: CheckId, verdict: Running, thread: ListedThread, giveUp: (reason: string) => void): Promise<void> {
    const end = async (reason: string) => {
      giveUp(reason);
      const { unstopped } = await stopThreads(bb, [thread.id]);
      for (const { why } of unstopped) bb.log.warn(`The verifier ${thread.id} of check ${checkId}, which ended, ${why}; nothing waits on it.`);
    };
    const watched = await watchHidden(bb, thread, "verifier", verdict.declined, now());
    if (watched.kind === "ended") return end(watched.reason);
    if (watched.declined.length > 0) store.recordDeclined(checkId, thread.id, watched.declined);
  }

  /**
   * Quiets the check's issue for the thread taking its environment (`to`, see quietIssue); says
   * whether it is quiet. While it isn't, logs why, and what waits (`waits`), for the next look or
   * tick to try again.
   */
  async function quietFor({ coordinatorId, issueId }: Check, to: GivenTo, waits: string): Promise<boolean> {
    const quieted = await quietIssue(bb, store, coordinatorId, issueId, to);
    if (quieted.kind !== "quiet") bb.log.warn(`On ${issueId}: ${unquietText(quieted)}, so ${waits}; the next tick tries again.`);
    return quieted.kind === "quiet";
  }

  /** Whether bb reports running the thread of the agent whose handoff the check judges; never for a final check, which judges none. */
  async function agentRuns(check: Check): Promise<boolean> {
    const [threadId] = agentThreadOf(check);
    if (threadId === undefined) return false;
    const thread = (await listedThreads(bb, [threadId])).get(threadId);
    return thread !== undefined && isRunning(thread);
  }

  /** The thread of the agent whose handoff the check judges; none for a final check, which judges none. */
  function agentThreadOf(check: Check): string[] {
    const { subject } = check;
    switch (subject.kind) {
      case "handoff":
        return [agentOf({ ...check, subject }).threadId];
      case "final":
        return [];
      default:
        return subject satisfies never;
    }
  }

  /** A handoff's check, the handoff it judges, its agent and its returned verdict, while that verdict is not settled; else null. */
  function unsettledOf(check: HandoffCheck): { check: HandoffCheck; handoff: Handoff; agent: Agent & { threadId: string }; verdict: Returned } | null {
    const now = store.check(check.id);
    if (now?.verdict.state !== "returned" || isSettled(now.verdict)) return null;
    const handed = store.handoff(check.subject.handoffId);
    // why throw: a check is inserted with its handoff, in one transaction.
    if (handed === null) throw new Error(`The handoff of check ${check.id} is missing.`);
    return { check, handoff: handed.handoff, agent: agentOf(check), verdict: now.verdict };
  }

  /**
   * The next step for an unsettled verdict (`current`: its handoff is still current in its agent's
   * thread, which bb still has; `thread`: that thread, as bb lists it), judged with CI on its commit
   * as the PR status of the agent's branch says, the branch the PR watch reads. One that passed all
   * but CI waits while CI is still to come. A failed one is sent back when its handoff is current,
   * the agent still holds its issue with a round left, its pull request hasn't merged (a merge
   * made the issue Done) and the issue's cap allows it (capAllowsSending); else it is checked, and
   * at the cap its settling asks the user (checks-store.ts settleReturned). One whose round is claimed was being sent when the
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
    const send = judged === "fail" && !merged && current && agent.ended === null && agent.fixRounds < MAX_AUTO_FIX_ROUNDS && capAllowsSending(check);
    return send ? { kind: "send", ci: settledCi } : { kind: "checked", refused: null, ci: settledCi };
  }

  /**
   * Whether the issue's cap lets the check's failure, still unsettled, go back to its agent: no cap
   * question of the issue is open, and settling it as the next counted failure asks none
   * (rounds/cap.ts mayGoBack). Read from the store, with no await, as stepOf decides.
   */
  function capAllowsSending({ coordinatorId, issueId }: HandoffCheck): boolean {
    const failed = countedFailures(store.record(coordinatorId, issueId)).length;
    return mayGoBack(failed + 1, capQuestionsOf(store.decisions(coordinatorId), issueId));
  }

  /**
   * In its issue's turn: settles a returned verdict. A final check's goes to the regional manager as
   * checked. A handoff's failed one's findings go back to its agent while it has a round left, once
   * its verifier no longer runs (see settleHandoffInTurn); anything else goes to the regional
   * manager as checked. Its issue says Verifying until then. Safe to run again at any point, as the
   * tick does after a crash or a reload: the round is claimed in the store before the findings
   * leave, and each step moves the verdict on only from where it was. A claim a crash or reload left
   * behind goes to the regional manager, which is told the findings may or may not have reached the
   * agent (see stepOf). The round comes back only when bb refused the findings (see sendBack).
   */
  async function settleInTurn(checkId: CheckId, by: Settler): Promise<void> {
    const check = checkOf(checkId);
    const { subject } = check;
    switch (subject.kind) {
      case "handoff":
        return settleHandoffInTurn({ ...check, subject }, by);
      case "final":
        return void inbox.settleCheck(checkId, FINAL_SETTLED);
      default:
        return subject satisfies never;
    }
  }

  /**
   * Settles a handoff's returned verdict, but sends its findings only once the issue is quiet for
   * the agent (see quietIssue), its verifier included, since they wake the agent in the verifier's
   * environment. Until then its settlement stays pending: owed, as the tick finds it after a reload
   * too. From inside issue_verdict the verifier is still running, so they wait for its idle event
   * or the tick; a look again stops the verifier whatever bb reports, as it has returned its
   * verdict and has nothing left to do, which also bounds the wait to the tick's.
   */
  async function settleHandoffInTurn(check: HandoffCheck, by: Settler): Promise<void> {
    const first = await stepNow(check);
    if (first === null) return;
    if (first.step.kind !== "send") return inbox.settleCheck(check.id, first.step);
    if (by === "verdict-tool") return;
    if (!(await quietFor(check, { kind: "thread", threadId: first.unsettled.agent.threadId }, "its findings wait"))) return;
    // why decide again: bb was asked meanwhile, and the agent may have moved on.
    const now = await stepNow(check);
    if (now === null) return;
    if (now.step.kind !== "send") return inbox.settleCheck(check.id, now.step);
    store.claimFixRound(check.id, now.step.ci);
    // why settle whatever happened meanwhile: the claim, not the verdict's old state, says the findings are owed.
    inbox.settleCheck(check.id, await sendBack(now.unsettled.agent, now.unsettled.check, now.unsettled.verdict, now.step.ci));
  }

  /** The next step for a handoff's verdict while it is unsettled (see stepOf), on bb's and the store's facts read now; null once it is settled. */
  async function stepNow(check: HandoffCheck): Promise<{ unsettled: NonNullable<ReturnType<typeof unsettledOf>>; step: Step } | null> {
    const agent = unsettledOf(check)?.agent;
    if (agent === undefined) return null;
    const thread = (await threadsById(bb, [agent.threadId])).get(agent.threadId) ?? null;
    // why only a holding agent's thread bb still has: bb answers 404 for a deleted thread's turns, and an ended agent is sent nothing.
    const sendable = agent.ended === null && thread !== null && thread.deletedAt === null;
    // why read bb first and the store right after, with no await before deciding: a turn the
    // agent starts after this read starts after the decision too.
    const latest = sendable ? await latestTurnSeq(bb, agent.threadId) : null;
    const unsettled = unsettledOf(check);
    if (unsettled === null) return null;
    return { unsettled, step: stepOf(unsettled, sendable && handoffIsCurrent(unsettled.handoff, latest), thread) };
  }

  /**
   * Sends a failed verdict's findings to the agent's thread as its verifier's message, so bb marks
   * them as another thread's, never the user's; says how the verdict settles. Taken: sent back.
   * Refused, as only some of bb's answers prove: checked, with bb's answer. Any other failure may
   * come after bb took them, so they may or may not have reached the agent.
   */
  async function sendBack(agent: Agent & { threadId: string }, { review }: HandoffCheck, verdict: Returned, ci: CiVerdict): Promise<Settlement> {
    try {
      await bb.sdk.threads.send({
        threadId: agent.threadId,
        senderThreadId: verdict.verifierThreadId,
        mode: "queue-if-active",
        input: [{ type: "text", text: findingsMessage(review, verdict, ci), mentions: [] }],
      });
      return { kind: "sent-back" };
    } catch (error) {
      bb.log.warn(`Could not send the verifier's findings to ${agent.id} (${agent.threadId}), so its regional manager decides: ${messageOf(error)}`);
      const refused = refusalOf(error);
      return refused === null ? { kind: "maybe-sent-back" } : { kind: "checked", refused, ci };
    }
  }

  /**
   * The commit a running check's verdict is on, and the tree it was judged in: a handoff's claimed
   * commit and the checkout read as it handed off; a final check's verifier's own worktree, read now.
   */
  async function judgedOf({ subject, verdict, id }: Check & { verdict: Running }): Promise<{ headSha: string; checkout: Checkout } | { unread: string }> {
    switch (subject.kind) {
      case "handoff":
        // why throw: a handoff's check is queued with the read made as it handed off, and keeps it running.
        if (verdict.checkout === null) throw new Error(`The check ${id} has no checkout to judge.`);
        return { headSha: subject.headSha, checkout: verdict.checkout };
      case "final": {
        const read = await judgedTree(bb, verdict.verifierThreadId);
        return read.kind === "read" ? { headSha: read.checkout.headSha, checkout: read.checkout } : { unread: read.reason };
      }
      default:
        return subject satisfies never;
    }
  }

  /**
   * In its issue's turn: a queued handoff's check whose review is still to come. Its running
   * reviewer is followed (review.ts follow); a queued one starts as a verifier does, once bb reports
   * the agent idle and the issue is quiet for it. Once the review is in or was missed, the verifier
   * starts in the same turn, so a review that couldn't be had never holds the check.
   */
  async function reviewInTurn(check: HandoffCheck): Promise<void> {
    if (check.review.state === "running") await review.follow(check);
    else if (!(await agentRuns(check)) && (await quietFor(check, { kind: "thread", threadId: null }, "no reviewer starts there yet"))) await review.start(check);
    const now = checkOf(check.id);
    if (now.verdict.state === "queued" && !isReviewing(now.review)) await startInTurn(now);
  }

  /** In its issue's turn: what a look again does for a check, by where its verdict, and before it its review, is now. */
  async function tend(checkId: CheckId): Promise<void> {
    const check = checkOf(checkId);
    const { subject } = check;
    if (reviewPending(check) && subject.kind === "handoff") return reviewInTurn({ ...check, subject });
    if (check.verdict.state === "queued") return startInTurn(check);
    if (check.verdict.state === "running") return followInTurn(checkId);
    return settleInTurn(checkId, "look");
  }

  /** Every check a look again tends: one still queued or running, or a returned verdict that waits for CI or that a crash, a reload or its running verifier left unsettled. */
  const tended = (): Check[] => [...store.openChecks(), ...store.unsettledChecks().map(checkOf)];

  /** In its issue's turn: tends each of the issue's checks a look again tends, as they are now. */
  async function tendIssue(coordinatorId: CoordinatorId, issueId: IssueId): Promise<void> {
    for (const { id } of tended().filter((check) => check.coordinatorId === coordinatorId && check.issueId === issueId)) await tend(id);
  }

  return {
    /**
     * In its issue's turn: stores an agent's handoff, with where its work is and what it ran on,
     * unless the agent ended while it waited. Returns its check (null: not done). why no verifier
     * yet: the agent's turn runs until this tool returns; its verifier starts once bb reports it idle.
     */
    handoff: ({ handoff, checkout, seen, execution }: Handing): Promise<{ check: Check | null } | { ended: EndedHow } | Busy> =>
      turns.run(handoff.coordinatorId, handoff.issueId, async () => {
        const agent = store.agent(handoff.coordinatorId, handoff.agentId);
        // why throw: the tool resolved the agent from its bound role, and agents are kept while their regional manager is.
        if (agent === null) throw new Error(`The agent ${handoff.agentId} of ${handoff.coordinatorId} is missing.`);
        if (agent.ended !== null) return { ended: agent.ended.how };
        if (seen !== null) store.recordCheckout(agent.coordinatorId, agent.id, seen);
        if (execution !== null) store.recordExecution(agent.coordinatorId, agent.id, execution);
        return { check: inbox.handoff(handoff, checkout) };
      }),

    /**
     * In its issue's turn: stores a verifier's verdict on the check it runs, if it is still that
     * check's running verifier, then settles it. The verdict is on the commit the agent claimed and
     * the checkout read as it handed off; for a final check, on the verifier's own worktree as read
     * now, and one bb's git plugin can't read ends the check as could-not-run. It keeps the model bb
     * ran the verifier on, and whether that is the model of an agent whose work it checks, as
     * stored when each handed off. A failed verdict's findings wait for its verifier's turn to end
     * (see settleHandoffInTurn).
     */
    returned(checkId: CheckId, verifierThreadId: string, report: VerifierReport): Promise<Received | Busy> {
      const { coordinatorId, issueId } = checkOf(checkId);
      return turns.run(coordinatorId, issueId, async () => {
        const check = checkOf(checkId);
        if (check.verdict.state !== "running" || check.verdict.verifierThreadId !== verifierThreadId) return "not-running";
        const judged = await judgedOf({ ...check, verdict: check.verdict });
        if ("unread" in judged) {
          const reason = `bb's git plugin couldn't read the verifier's worktree as it returned its verdict (${judged.unread})`;
          return inbox.giveUpCheck(checkId, { state: "running", verifierThreadId }, { verifierThreadId, reason }, now()) === null ? "not-running" : judged;
        }
        const ran = await threadExecution(bb, verifierThreadId);
        // why throw: the verifier calls issue_verdict from inside a turn, so bb has its model on record.
        if (ran === null) throw new Error(`bb has no model on record for ${verifierThreadId}.`);
        const model = { providerId: ran.providerId, model: ran.model };
        const onTheirs = checkedAgents(check, store.agents(coordinatorId)).some(({ execution }) => sameModel(model, execution));
        const findings = [...check.verdict.declined.map(declinedFinding), ...report.findings];
        if (!store.receiveVerdict(checkId, { state: "returned", verifierThreadId, ...judged, ...report, findings, model, sameModel: onTheirs }, now())) return "not-running";
        // why not fail the verdict: it is stored, and the tick settles it.
        await settleInTurn(checkId, "verdict-tool").catch((error: unknown) => bb.log.warn(`Could not settle the verdict of check ${checkId} yet; the next tick tries again: ${messageOf(error)}`));
        return "recorded";
      });
    },

    /** In its issue's turn: starts the check's verifier while it is queued (see startInTurn). The final checks' pass starts a final check's with it. */
    startInTurn,

    /**
     * A thread of the issue, its agent's or a verifier's, went idle or failed, which is when a
     * queued check can start, a quiet verifier be reminded, or findings be sent. In the issue's
     * turn, waiting for it as a tool does, it tends the issue's checks as they are then; Busy, after
     * the wait, leaves them to the tick.
     */
    async lookAgain(coordinatorId: CoordinatorId, issueId: IssueId): Promise<void> {
      if (!tended().some((check) => check.coordinatorId === coordinatorId && check.issueId === issueId)) return;
      await turns.run(coordinatorId, issueId, () => tendIssue(coordinatorId, issueId));
    },

    /**
     * The tick's pass, after the PR watch's reads: one turn per issue with a check a look again
     * tends, which starts, follows or settles each. why it never waits: an issue whose turn is taken
     * is skipped until the next tick, and the pass doesn't wait for the turns it starts, so a call
     * bb never answers holds up only its own issue, not another one, nor the inbox's pass.
     */
    async reconcile(): Promise<void> {
      const issues = new Map(tended().map(({ coordinatorId, issueId }) => [`${coordinatorId}/${issueId}`, { coordinatorId, issueId }]));
      for (const { coordinatorId, issueId } of issues.values()) {
        turns
          .runIfFree(coordinatorId, issueId, () => tendIssue(coordinatorId, issueId))
          .catch((error: unknown) => bb.log.warn(`Could not reconcile the verifiers of ${issueId}; the next tick tries again: ${messageOf(error)}`));
      }
    },
  };
}

/** A finding of a verdict whose verifier asked a person something, as the plugin declined it. */
const declinedFinding = (asked: string): string =>
  `The verifier asked a person "${asked}"; nobody answers a verifier, so the plugin declined it, and the verifier went on without it.`;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
