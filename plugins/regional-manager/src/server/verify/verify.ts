import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { branchOf, type Agent, type AgentCheckout, type EndedHow } from "../../model/agent.ts";
import { sameModel, type Execution } from "../../model/execution.ts";
import { handoffIsCurrent, type GivenHandoff, type Handoff } from "../../model/handoff.ts";
import type { Coordinator } from "../../contract.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { checkedAgents, type Check, type CheckId, type HandoffCheck } from "../../model/verdict/check.ts";
import type { Checkout, CheckoutRead } from "../../model/verdict/checkout.ts";
import { ciOf, type CiVerdict } from "../../model/verdict/pr.ts";
import { isSettled, judge, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";
import { environmentGone, type EnvironmentsBb } from "../agents/environments.ts";
import { isRunning, latestTurnSeq, listedThreads, stopThreads, threadsById, type TurnsBb } from "../agents/threads.ts";
import type { CatalogBb } from "../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import { quietIssue, unquietText, type GivenTo, type QuietBb } from "../issues/quiet.ts";
import type { Spawner, VerifierRequest } from "../spawn.ts";
import type { Settlement } from "../store/issue/checks-store.ts";
import type { Store } from "../store/store.ts";
import { finalVerifierRequest, judgedTree, type FinalVerifierBb } from "./final-check/final-verifier.ts";
import { findingsMessage } from "./findings.ts";
import { refusalOf } from "./send-refusal.ts";
import { declineAsks, type AsksBb } from "./verifier-asks.ts";
import { stalled, STALL_MS, type ActivityBb } from "./verifier-stall.ts";
import { verifierExecution } from "./verifier-model.ts";
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
  >;
  spawner: Pick<Spawner, "verifier">;
  inbox: Pick<Inbox, "handoff" | "giveUpCheck" | "settleCheck">;
  turns: IssueTurns;
  now(): number;
};

/** A verifier's report: each criterion named by its text, and its findings. */
export type VerifierReport = Pick<Extract<Verdict, { state: "returned" }>, "findings"> & { criteria: { criterion: string; result: CriterionResult; evidence: string }[] };

type Received = "recorded" | "not-running" | { unread: string };

type Handing = { handoff: GivenHandoff; checkout: CheckoutRead; seen: AgentCheckout | null; execution: Execution | null };

type Returned = Extract<Verdict, { state: "returned" }>;
type Running = Extract<Verdict, { state: "running" }>;

type Step = { kind: "send"; ci: CiVerdict } | Exclude<Settlement, { kind: "sent-back" }>;

type Settler = "verdict-tool" | "look";

const FINAL_SETTLED: Settlement = { kind: "checked", refused: null, ci: { kind: "none" } };

const CI_UNFINISHED: CiVerdict = { kind: "not-checked", reason: "CI hadn't finished when its criteria failed" };

const MAX_AUTO_FIX_ROUNDS = 1;

const NUDGE =
  "You ended your turn without calling issue_verdict, so nobody has your verdict. Finish checking each done-criterion and call issue_verdict once; it is the only way your verdict reaches anyone.";

export type Verify = ReturnType<typeof createVerify>;

export function createVerify({ bb, store, spawner, inbox, turns, now }: Deps) {
  function agentOf(check: HandoffCheck): Agent & { threadId: string } {
    const agent = store.agent(check.coordinatorId, check.subject.agentId);
    if (agent === null || agent.threadId === null) throw new Error(`The agent ${check.subject.agentId} of ${check.coordinatorId} has no thread.`);
    return { ...agent, threadId: agent.threadId };
  }

  function managerThreadOf(coordinatorId: CoordinatorId): string {
    const coordinator = store.coordinator(coordinatorId);
    if (coordinator === null) throw new Error(`The regional manager ${coordinatorId} is missing.`);
    return coordinator.threadId;
  }

  function checkOf(checkId: CheckId): Check {
    const check = store.check(checkId);
    if (check === null) throw new Error(`The check ${checkId} is missing.`);
    return check;
  }

  async function requestFor(checkId: CheckId): Promise<VerifierRequest | null> {
    const check = store.check(checkId);
    if (check?.verdict.state !== "queued") return null;
    const coordinator = store.coordinator(check.coordinatorId);
    const issue = store.issue(check.coordinatorId, check.issueId);
    if (coordinator === null || issue === null) throw new Error(`The issue ${check.issueId} of ${check.coordinatorId} or its regional manager is missing.`);
    const { subject } = check;
    switch (subject.kind) {
      case "handoff":
        return handoffRequest({ ...check, subject }, coordinator, issue, check.verdict.checkout);
      case "final": {
        const theirs = checkedAgents(check, store.agents(check.coordinatorId)).map(({ execution }) => execution);
        return finalVerifierRequest(bb, { check: { ...check, subject }, coordinator, issue, theirs });
      }
      default:
        return subject satisfies never;
    }
  }

  async function handoffRequest(check: HandoffCheck, coordinator: Coordinator, issue: Issue, checkout: Checkout | null): Promise<VerifierRequest | null> {
    const agent = agentOf(check);
    if (issue.brief === null || checkout === null) throw new Error(`The check ${check.id} of ${issue.id} has no brief or no checkout to verify.`);
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
    return {
      role: { kind: "verifier", coordinatorId: coordinator.id, issueId: issue.id, checkId: check.id },
      coordinator,
      parentThreadId: agent.threadId,
      title: `Verify ${issue.id}: ${issue.title}`,
      environment: { type: "reuse", environmentId: thread.environmentId },
      execution,
      prompt: verifierBrief({ ...issue, brief: issue.brief }, check, checkout),
    };
  }

  async function startInTurn(check: Check): Promise<void> {
    const { id } = check;
    if (await agentRuns(check)) return;
    if (!(await quietFor(check, { kind: "thread", threadId: null }, "no verifier starts there yet"))) return;
    try {
      const request = await requestFor(id);
      if (request === null) return;
      await spawner.verifier(request);
    } catch (error) {
      inbox.giveUpCheck(id, { state: "queued" }, { state: "could-not-run", verifierThreadId: null, reason: `bb did not start a verifier: ${messageOf(error)}` });
    }
  }

  async function followInTurn(checkId: CheckId): Promise<void> {
    const { verdict, coordinatorId } = checkOf(checkId);
    if (verdict.state !== "running") return;
    const { verifierThreadId } = verdict;
    const from = { state: "running", verifierThreadId } as const;
    const giveUp = (reason: string) => inbox.giveUpCheck(checkId, from, { state: "could-not-run", verifierThreadId, reason });
    const thread = (await listedThreads(bb, [verifierThreadId])).get(verifierThreadId) ?? null;
    if (thread === null) return void giveUp("its verifier thread was archived or deleted before it returned a verdict");
    if (isRunning(thread)) return watchRunning(checkId, verdict, thread, giveUp);
    const destroyed = thread.environmentId !== null && (await environmentGone(bb, thread.environmentId));
    if (destroyed) return void giveUp("its environment was removed (a sandbox removed or reaped) before its verifier returned a verdict");
    if (verdict.nudged) return void giveUp("its verifier stopped without a verdict twice, the second time after a reminder");
    const check = checkOf(checkId);
    if (await agentRuns(check)) return;
    if (!(await quietFor(check, { kind: "thread", threadId: verifierThreadId }, "its verifier isn't reminded yet"))) return;
    const managerThreadId = managerThreadOf(coordinatorId);
    if (!store.markNudged(checkId, verifierThreadId, true)) return;
    try {
      await bb.sdk.threads.send({ threadId: thread.id, senderThreadId: managerThreadId, mode: "queue-if-active", input: [{ type: "text", text: NUDGE, mentions: [] }] });
    } catch (error) {
      bb.log.warn(`Could not remind the verifier ${thread.id} to return its verdict: ${messageOf(error)}`);
    }
  }

  async function watchRunning(checkId: CheckId, verdict: Running, thread: ListedThread, giveUp: (reason: string) => void): Promise<void> {
    const end = async (reason: string) => {
      giveUp(reason);
      const { unstopped } = await stopThreads(bb, [thread.id]);
      for (const { why } of unstopped) bb.log.warn(`The verifier ${thread.id} of check ${checkId}, which ended, ${why}; nothing waits on it.`);
    };
    if (thread.hasPendingInteraction) {
      const declined = await declineAsks(bb, thread.id);
      const refused = declined.find(({ refused }) => refused !== null);
      if (refused !== undefined) return end(`its verifier asked a person "${refused.asked}", and bb refused the plugin's decline: ${refused.refused}`);
      store.recordDeclined(checkId, thread.id, declined.map(({ asked }) => asked));
      return;
    }
    if (!(await stalled(bb, thread.id, thread.createdAt, now()))) return;
    const asked = verdict.declined.length === 0 ? "" : `, after the plugin declined what it asked a person (${verdict.declined.map((ask) => `"${ask}"`).join("; ")})`;
    await end(`its verifier showed no activity for ${STALL_MS / 60_000} minutes${asked}`);
  }

  async function quietFor({ coordinatorId, issueId }: Check, to: GivenTo, waits: string): Promise<boolean> {
    const quieted = await quietIssue(bb, store, coordinatorId, issueId, to);
    if (quieted.kind !== "quiet") bb.log.warn(`On ${issueId}: ${unquietText(quieted)}, so ${waits}; the next tick tries again.`);
    return quieted.kind === "quiet";
  }

  async function agentRuns(check: Check): Promise<boolean> {
    const [threadId] = agentThreadOf(check);
    if (threadId === undefined) return false;
    const thread = (await listedThreads(bb, [threadId])).get(threadId);
    return thread !== undefined && isRunning(thread);
  }

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

  function unsettledOf(check: HandoffCheck): { check: HandoffCheck; handoff: Handoff; agent: Agent & { threadId: string }; verdict: Returned } | null {
    const now = store.check(check.id);
    if (now?.verdict.state !== "returned" || isSettled(now.verdict)) return null;
    const handed = store.handoff(check.subject.handoffId);
    if (handed === null) throw new Error(`The handoff of check ${check.id} is missing.`);
    return { check, handoff: handed.handoff, agent: agentOf(check), verdict: now.verdict };
  }

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

  async function settleHandoffInTurn(check: HandoffCheck, by: Settler): Promise<void> {
    const first = await stepNow(check);
    if (first === null) return;
    if (first.step.kind !== "send") return inbox.settleCheck(check.id, first.step);
    if (by === "verdict-tool") return;
    if (!(await quietFor(check, { kind: "thread", threadId: first.unsettled.agent.threadId }, "its findings wait"))) return;
    const now = await stepNow(check);
    if (now === null) return;
    if (now.step.kind !== "send") return inbox.settleCheck(check.id, now.step);
    store.claimFixRound(check.id, now.step.ci);
    inbox.settleCheck(check.id, await sendBack(now.unsettled.agent, now.unsettled.verdict, now.step.ci));
  }

  async function stepNow(check: HandoffCheck): Promise<{ unsettled: NonNullable<ReturnType<typeof unsettledOf>>; step: Step } | null> {
    const agent = unsettledOf(check)?.agent;
    if (agent === undefined) return null;
    const thread = (await threadsById(bb, [agent.threadId])).get(agent.threadId) ?? null;
    const sendable = agent.ended === null && thread !== null && thread.deletedAt === null;
    const latest = sendable ? await latestTurnSeq(bb, agent.threadId) : null;
    const unsettled = unsettledOf(check);
    if (unsettled === null) return null;
    return { unsettled, step: stepOf(unsettled, sendable && handoffIsCurrent(unsettled.handoff, latest), thread) };
  }

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

  async function judgedOf({ subject, verdict, id }: Check & { verdict: Running }): Promise<{ headSha: string; checkout: Checkout } | { unread: string }> {
    switch (subject.kind) {
      case "handoff":
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

  async function tend(checkId: CheckId): Promise<void> {
    const check = checkOf(checkId);
    if (check.verdict.state === "queued") return startInTurn(check);
    if (check.verdict.state === "running") return followInTurn(checkId);
    return settleInTurn(checkId, "look");
  }

  const tended = (): Check[] => [...store.openChecks(), ...store.unsettledChecks().map(checkOf)];

  async function tendIssue(coordinatorId: CoordinatorId, issueId: IssueId): Promise<void> {
    for (const { id } of tended().filter((check) => check.coordinatorId === coordinatorId && check.issueId === issueId)) await tend(id);
  }

  return {
    handoff: ({ handoff, checkout, seen, execution }: Handing): Promise<{ check: Check | null } | { ended: EndedHow } | Busy> =>
      turns.run(handoff.coordinatorId, handoff.issueId, async () => {
        const agent = store.agent(handoff.coordinatorId, handoff.agentId);
        if (agent === null) throw new Error(`The agent ${handoff.agentId} of ${handoff.coordinatorId} is missing.`);
        if (agent.ended !== null) return { ended: agent.ended.how };
        if (seen !== null) store.recordCheckout(agent.coordinatorId, agent.id, seen);
        if (execution !== null) store.recordExecution(agent.coordinatorId, agent.id, execution);
        return { check: inbox.handoff(handoff, checkout) };
      }),

    returned(checkId: CheckId, verifierThreadId: string, report: VerifierReport): Promise<Received | Busy> {
      const { coordinatorId, issueId } = checkOf(checkId);
      return turns.run(coordinatorId, issueId, async () => {
        const check = checkOf(checkId);
        if (check.verdict.state !== "running" || check.verdict.verifierThreadId !== verifierThreadId) return "not-running";
        const judged = await judgedOf({ ...check, verdict: check.verdict });
        if ("unread" in judged) {
          const reason = `bb's git plugin couldn't read the verifier's worktree as it returned its verdict (${judged.unread})`;
          return inbox.giveUpCheck(checkId, { state: "running", verifierThreadId }, { state: "could-not-run", verifierThreadId, reason }) === null ? "not-running" : judged;
        }
        const ran = await threadExecution(bb, verifierThreadId);
        if (ran === null) throw new Error(`bb has no model on record for ${verifierThreadId}.`);
        const model = { providerId: ran.providerId, model: ran.model };
        const onTheirs = checkedAgents(check, store.agents(coordinatorId)).some(({ execution }) => sameModel(model, execution));
        const findings = [...check.verdict.declined.map(declinedFinding), ...report.findings];
        if (!store.receiveVerdict(checkId, { state: "returned", verifierThreadId, ...judged, ...report, findings, model, sameModel: onTheirs })) return "not-running";
        await settleInTurn(checkId, "verdict-tool").catch((error: unknown) => bb.log.warn(`Could not settle the verdict of check ${checkId} yet; the next tick tries again: ${messageOf(error)}`));
        return "recorded";
      });
    },

    startInTurn,

    async lookAgain(coordinatorId: CoordinatorId, issueId: IssueId): Promise<void> {
      if (!tended().some((check) => check.coordinatorId === coordinatorId && check.issueId === issueId)) return;
      await turns.run(coordinatorId, issueId, () => tendIssue(coordinatorId, issueId));
    },

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

const declinedFinding = (asked: string): string =>
  `The verifier asked a person "${asked}"; nobody answers a verifier, so the plugin declined it, and the verifier went on without it.`;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
