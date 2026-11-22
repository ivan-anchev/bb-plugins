import { randomUUID } from "node:crypto";
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { Coordinator } from "../../contract.ts";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import {
  cutPlan,
  environmentOf,
  handoverOf,
  holderOf,
  issueBranch,
  moveTo,
  placementOf,
  refOf,
  startsClean,
  type Agent,
  type AgentCheckout,
  type AgentId,
  type Base,
  type EndedHow,
  type Placement,
  type PlacementFacts,
  type Previous,
  type RequestedPlacement,
  type StartFrom,
} from "../../model/agent.ts";
import type { Kind } from "../../model/issue/kind.ts";
import { catalogRouting, sameModel, type Execution, type RequestedExecution } from "../../model/execution.ts";
import { handoffIsCurrent, type HandoffId } from "../../model/handoff.ts";
import { briefToStart, type Issue, type IssueId } from "../../model/issue/issue.ts";
import type { Related } from "../../model/issue/relations.ts";
import { headlineText, keepsPlaceAfterEnd, type IssueView } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { PrRead } from "../../model/verdict/pr.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import { checkoutReadOf, gitStatusOf, type GitStatusBb } from "../git-status.ts";
import { inheritedFrom, type Inherited, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Inbox } from "../inbox/inbox.ts";
import { readIssue, type FactsBb, type FactsStore } from "../issues/views/issue-facts.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import { didText, quietIssue, recipientsText, unquietText, type QuietBb, type Unquiet, type Withdrawn } from "../issues/quiet.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Spawner } from "../spawn.ts";
import type { NewAgent } from "../store/issue/agents-store.ts";
import type { Store } from "../store/store.ts";
import type { PrWatch } from "../watch/pr-watch.ts";
import { agentBrief } from "./brief.ts";
import { environmentGone, type EnvironmentsBb } from "./environments.ts";
import { latestTurnSeq, stopThreads, threadsById, type ListBb } from "./threads.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type EnvironmentArgs = NewThreadRequest["environment"];

/** An agent's or a regional manager's thread as the agents read it. */
type ListedThread = {
  id: string;
  providerId: string;
  status: string;
  environmentId: string | null;
  environmentBranchName: string | null;
  environmentHostId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
};

/** The parts of bb agent actions use, down to the fields they read. */
type AgentsBb = CatalogBb &
  GitStatusBb &
  ThreadExecutionBb &
  FactsBb &
  EnvironmentsBb &
  QuietBb &
  ListBb<ListedThread> & {
    log: Pick<PluginLogger, "warn">;
    sdk: {
      threads: {
        send(args: Parameters<Threads["send"]>[0]): Promise<{ delivery: "sent" | "queued" }>;
        archive(args: { threadId: string }): Promise<unknown>;
      };
    };
  };

type StartRequest = { issueId: IssueId; from: StartFrom; execution?: RequestedExecution; placement?: RequestedPlacement };

type RunsOn = { execution: Execution; inherited: Pick<Inherited, "serviceTier"> | null };

type Spot = { placement: Placement; environment: EnvironmentArgs; base: Base; checkout: AgentCheckout };

type Asked = { kind: Kind; from: StartFrom; placement: Placement | null };

type Prove = (agent: Agent, branch: string, head: string) => Promise<PrRead>;

type Decided = { issueId: IssueId; asked: Asked; spot: Spot; runsOn: RunsOn; after: AgentId | null };

type Taken = { issue: Issue; brief: string; blockedBy: Related[]; spot: Spot; agentId: AgentId; ticket: string; replaced: AgentId | null; withdrawn: Withdrawn[] };

/**
 * What a new agent carries over from the previous one, `from`: `joined`, its environment, made by
 * `placement`, on its branch; `cut`, a new environment of `placement` on a new branch cut from its
 * branch, `via` origin or the local branch, expecting `head` there (null: none known). `pr`: the
 * number of the branch's pull request while open as last read (null: none known).
 */
export type Carried =
  | { kind: "joined"; from: AgentId; placement: Placement; branch: string | null; pr: number | null }
  | (Extract<Base, { kind: "cut" }> & { placement: Placement; pr: number | null });

/**
 * Where a start stands in its issue's succession of agents: `after`, the issue's previous agent (null: the first);
 * `replaced`, the agent it stopped and replaced (null: none held the issue); `withdrawn`, the
 * regional manager's messages to the issue's agents taken back from bb's queue; `carried`, what it
 * carries over from the previous agent (null: a clean start).
 */
type Succession = { after: AgentId | null; replaced: AgentId | null; withdrawn: Withdrawn[]; carried: Carried | null };

/**
 * What a start did: refused before anything changed; started, on `execution` (`inherited`: the
 * regional manager's own), on an issue `blockedBy` these as it started (a dependency informs, never
 * refuses); or inserted and then refused by bb.
 */
export type StartOutcome =
  | { kind: "refused"; reason: string }
  | ({ kind: "started"; agentId: AgentId; threadId: string; execution: Execution; inherited: boolean; blockedBy: Related[] } & Succession)
  | ({ kind: "failed"; agentId: AgentId; error: string } & Succession);

/** What a stop did. An agent ends as stopped only once bb confirms its thread no longer runs; `why` it hasn't: the status bb still reports, or bb's error that left the stop unconfirmed. */
export type StopOutcome = { kind: "stopped"; archived: boolean } | { kind: "already-ended"; how: EndedHow } | { kind: "still-running"; why: string };

type MessageOutcome =
  | { kind: "sent" | "queued"; dropped: boolean }
  | { kind: "unbound" }
  | { kind: "already-ended"; how: EndedHow }
  | { kind: "unquiet"; unquiet: Unquiet };

type Deps = {
  bb: AgentsBb;
  store: FactsStore &
    Pick<
      Store,
      "coordinator" | "coordinators" | "issue" | "agent" | "issueThreads" | "roleOfThread" | "markNudged" | "insertAgent" | "replaceAgent" | "record" | "agentTicket" | "removeCoordinator" | "supersedeOpenChecks" | "issueDecisions"
    >;
  spawner: Pick<Spawner, "agent">;
  inbox: Pick<Inbox, "endAgent">;
  memory: MemoryRoot;
  turns: IssueTurns;
  prs: Pick<PrWatch, "readNow">;
  /** What bb says about where the regional manager's agents can run, read when agent_start names a placement. */
  placementFacts(id: CoordinatorId): Promise<PlacementFacts>;
  /** Runs after anything that changes a regional manager's board. */
  onChange(id: CoordinatorId): void;
  /** Runs after a regional manager whose thread bb deleted is removed. */
  onRemoved(id: CoordinatorId): void;
};

export type Agents = ReturnType<typeof createAgents>;

const CREW_RULES = memoryFileSchema.parse("CREW.md");
const MEMORY_INDEX = memoryFileSchema.parse("MEMORY.md");
const WORKTREE = { kind: "worktree" } as const;
const NO_CHECKOUT: AgentCheckout = { environmentId: null, branch: null, head: null };

export function createAgents({ bb, store, spawner, inbox, memory, turns, prs, placementFacts, onChange, onRemoved }: Deps) {
  function coordinatorOf(id: CoordinatorId): Coordinator {
    const coordinator = store.coordinator(id);
    if (coordinator === null) throw new Error(`The regional manager ${id} has no thread.`);
    return coordinator;
  }

  async function listed(threadId: string): Promise<ListedThread | null> {
    return (await threadsById(bb, [threadId])).get(threadId) ?? null;
  }

  async function executionFor(coordinator: Coordinator, requested: RequestedExecution | undefined, environment: EnvironmentArgs, where: string): Promise<RunsOn | { refused: string }> {
    if (requested === undefined) {
      const own = await inheritedFrom(bb, coordinator.threadId);
      return own === null ? { refused: "bb has no model on record for you yet, so the agent has none to inherit. Name one with execution." } : { execution: own.execution, inherited: { serviceTier: own.serviceTier } };
    }
    const resolved = await resolvedExecution(bb, catalogRouting(environment), requested);
    if ("refused" in resolved) return { refused: `Nothing changed. Where the agent would run (${where}): ${resolved.refused}` };
    return { execution: resolved, inherited: null };
  }

  async function previousOf(coordinatorId: CoordinatorId, issueId: IssueId): Promise<Omit<Previous, "now" | "pushed"> | null> {
    const own = store.agents(coordinatorId).filter((each): each is Agent & { threadId: string } => each.issueId === issueId && each.threadId !== null);
    const threads = await threadsById(bb, own.map(({ threadId }) => threadId));
    const threadOf = (agent: Agent & { threadId: string }) => threads.get(agent.threadId) ?? null;
    const on = issueBranch(own, threadOf);
    const agent = on?.agent ?? own.at(-1);
    if (agent === undefined) return null;
    const known = agent.checkout.environmentId ?? threadOf(agent)?.environmentId ?? null;
    const environmentId = known !== null && !(await environmentGone(bb, known)) ? known : null;
    return { agent, environmentId, branch: on?.branch ?? null };
  }

  async function previousFor(coordinatorId: CoordinatorId, issueId: IssueId, { kind, from, placement }: Asked, prove: Prove): Promise<Previous | null> {
    if (startsClean(kind, from)) return null;
    const found = await previousOf(coordinatorId, issueId);
    if (found === null) return null;
    const to = moveTo(placement, found);
    if (to === null) return { ...found, now: null, pushed: null };
    const now = found.environmentId === null ? null : checkoutReadOf(await gitStatusOf(bb, found.environmentId));
    const plan = cutPlan({ ...found, now }, to);
    const proving = "prove" in plan ? plan.prove : null;
    const pushed = proving === null || proving.head === null ? null : await prove(found.agent, proving.branch, proving.head);
    return { ...found, now, pushed };
  }

  async function spotOf(coordinatorId: CoordinatorId, issueId: IssueId, asked: Asked, prove: Prove): Promise<Spot | { refused: string }> {
    const handover = handoverOf(asked.kind, asked, await previousFor(coordinatorId, issueId, asked, prove));
    if ("refused" in handover) return handover;
    if (handover.kind === "join") return handover;
    const { placement, base, ref } = handover.kind === "cut" ? { ...handover, ref: refOf(handover.base) } : { placement: asked.placement ?? WORKTREE, base: { kind: "default" } as const, ref: null };
    const manager = await listed(coordinatorOf(coordinatorId).threadId);
    return { placement, environment: environmentOf(placement, manager?.environmentHostId ?? null, ref), base, checkout: NO_CHECKOUT };
  }

  function startable(coordinatorId: CoordinatorId, issueId: IssueId, view: IssueView, { execution, inherited }: RunsOn): { issue: Issue; brief: string } | { refused: string } {
    const issue = issueOf(coordinatorId, issueId);
    const final = finalText(issue, view) ?? parentText(issue, store.issues(coordinatorId));
    if (final !== null) return { refused: final };
    const planned = briefToStart(issue);
    if ("refused" in planned) return planned;
    if (issue.verifier !== null && sameModel(issue.verifier, execution)) {
      return {
        refused: `${issue.id}'s verifier is ${executionText(issue.verifier)}, so an agent on ${inherited === null ? "it" : "your own model"} couldn't be checked by another model. Name another execution, or change ${issue.id}'s verifier with issue_update.`,
      };
    }
    return { issue, brief: planned.brief };
  }

  function start(coordinatorId: CoordinatorId, request: StartRequest): Promise<StartOutcome | Busy> {
    return turns.run(coordinatorId, request.issueId, async () => {
      const prove = provenOnce(coordinatorId);
      const decided = await decide(coordinatorId, request, prove);
      if ("refused" in decided) return { kind: "refused", reason: decided.refused };
      const taken = await takeOver(coordinatorId, decided, prove);
      if ("refused" in taken) return { kind: "refused", reason: taken.refused };
      return spawn(coordinatorId, decided, taken);
    });
  }

  function provenOnce(coordinatorId: CoordinatorId): Prove {
    let last: { branch: string; head: string; read: Promise<PrRead> } | null = null;
    return (agent, branch, head) => {
      if (last === null || last.branch !== branch || last.head !== head) last = { branch, head, read: prs.readNow(coordinatorId, agent, branch) };
      return last.read;
    };
  }

  async function decide(coordinatorId: CoordinatorId, { issueId, from, execution, placement }: StartRequest, prove: Prove): Promise<Decided | { refused: string }> {
    const filed = store.issue(coordinatorId, issueId);
    if (filed === null) return { refused: `You have no issue ${issueId}. crew_catch_up lists your issues.` };
    const parent = parentText(filed, store.issues(coordinatorId));
    if (parent !== null) return { refused: parent };
    const named = placement === undefined ? null : placementOf(placement, await placementFacts(coordinatorId));
    if (named !== null && "refused" in named) return named;
    const asked: Asked = { kind: filed.kind, from, placement: named };
    const spot = await spotOf(coordinatorId, filed.id, asked, prove);
    if ("refused" in spot) return { refused: `Nothing changed. ${spot.refused}` };
    const runsOn = await executionFor(coordinatorOf(coordinatorId), execution, spot.environment, whereText(spot));
    if ("refused" in runsOn) return runsOn;
    const ready = startable(coordinatorId, filed.id, (await readIssue(bb, store, filed)).view, runsOn);
    if ("refused" in ready) return ready;
    const after = store.agents(coordinatorId).filter((agent) => agent.issueId === filed.id && agent.threadId !== null).at(-1)?.id ?? null;
    return { issueId: filed.id, asked, spot, runsOn, after };
  }

  async function takeOver(coordinatorId: CoordinatorId, decided: Decided, prove: Prove): Promise<Taken | { refused: string }> {
    const { issueId, runsOn } = decided;
    const holder = holderOf(store.agents(coordinatorId), issueId);
    const quieted = await quietForStart(coordinatorId, issueId, holder);
    if ("refused" in quieted) return quieted;
    const spot = decided.spot.base.kind === "cut" ? await spotOf(coordinatorId, issueId, decided.asked, prove) : decided.spot;
    if ("refused" in spot) return { refused: `${quieted.did}${spot.refused}` };
    const turnSeq = holder === null || holder.threadId === null ? null : await latestTurnSeq(bb, holder.threadId);
    const { view } = await readIssue(bb, store, { coordinatorId, id: issueId });
    const now = startable(coordinatorId, issueId, view, runsOn);
    if ("refused" in now) return { refused: `${quieted.did}${now.refused}` };
    const next: NewAgent = { coordinatorId, issueId, ticket: randomUUID(), ...spot, execution: runsOn.execution, at: Date.now() };
    const agentId = holder === null ? store.insertAgent(next) : store.replaceAgent(holder, leftBy(holder, turnSeq), next);
    if (agentId === null) return { refused: `${quieted.did}${issueId} changed hands meanwhile. crew_catch_up shows who holds it now.` };
    return { ...now, blockedBy: view.blockedBy, spot, agentId, ticket: next.ticket, replaced: holder?.id ?? null, withdrawn: quieted.withdrawn };
  }

  async function quietForStart(coordinatorId: CoordinatorId, issueId: IssueId, holder: Agent | null): Promise<{ withdrawn: Withdrawn[]; did: string } | { refused: string }> {
    const quieted = await quietIssue(bb, store, coordinatorId, issueId, { kind: "new-agent" });
    const holds = holder === null ? "" : ` and ${holder.id} still holds ${issueId}`;
    switch (quieted.kind) {
      case "quiet": {
        const did = didText(quieted);
        return { withdrawn: quieted.withdrawn, did: did === "" ? "" : `${did}nothing else changed: ` };
      }
      case "left":
        return { refused: `${unquietText(quieted)}; once sent, it would wake ${recipientsText(quieted.left)} beside a new agent, so no agent started${holds}. Call agent_start again once bb has sent or deleted it.` };
      case "unstopped":
        return { refused: `${unquietText(quieted)}, so no agent started${holds}. Call agent_start again once it has stopped.` };
      default:
        return quieted satisfies never;
    }
  }

  async function spawn(coordinatorId: CoordinatorId, { runsOn, after }: Decided, { issue, brief, blockedBy, spot, agentId, ticket, replaced, withdrawn }: Taken): Promise<StartOutcome> {
    const { execution, inherited } = runsOn;
    const carried = carriedOf(coordinatorId, spot);
    const succession: Succession = { after, replaced, withdrawn, carried };
    const started = (threadId: string): StartOutcome => ({ kind: "started", agentId, threadId, execution, inherited: inherited !== null, blockedBy, ...succession });
    onChange(coordinatorId);
    const files = memory.of(coordinatorId);
    try {
      const prompt = agentBrief(
        agentId,
        coordinatorOf(coordinatorId).threadId,
        { ...issue, brief, decisions: store.issueDecisions(coordinatorId, issue.id) },
        { base: spot.base, branch: carried?.branch ?? null, pr: carried?.pr ?? null, earlier: store.record(coordinatorId, issue.id) },
        { crewRules: files.read(CREW_RULES).text, index: files.read(MEMORY_INDEX).text },
      );
      return started(await spawner.agent(ticket, { coordinator: coordinatorOf(coordinatorId), title: issue.title, environment: spot.environment, execution, serviceTier: inherited?.serviceTier ?? null, prompt }));
    } catch (error) {
      const threadId = store.agent(coordinatorId, agentId)?.threadId ?? null;
      if (threadId !== null) return started(threadId);
      inbox.endAgent({ coordinatorId, id: agentId, issueId: issue.id }, "spawn-failed", null, false);
      return { kind: "failed", agentId, error: error instanceof Error ? error.message : String(error), ...succession };
    } finally {
      onChange(coordinatorId);
    }
  }

  function leftBy(agent: Agent, turnSeq: number | null): HandoffId | null {
    const latest = store.latestHandoff(agent.coordinatorId, agent.id);
    return latest !== null && handoffIsCurrent(latest.handoff, turnSeq) ? latest.handoff.id : null;
  }

  function carriedOf(coordinatorId: CoordinatorId, { base, placement, checkout }: Spot): Carried | null {
    const openPr = (branch: string | null): number | null => {
      const pr = branch === null ? null : (store.prOfBranch(coordinatorId, branch)?.snapshot ?? null);
      return pr?.state === "open" ? pr.number : null;
    };
    switch (base.kind) {
      case "default":
        return null;
      case "joined":
        return { kind: "joined", from: base.from, placement, branch: checkout.branch, pr: openPr(checkout.branch) };
      case "cut":
        return { ...base, placement, pr: openPr(base.branch) };
      default:
        return base satisfies never;
    }
  }

  async function end({ coordinatorId, id }: Agent, how: Extract<EndedHow, "stopped" | "archived" | "deleted">): Promise<void> {
    const agent = agentOf(coordinatorId, id);
    if (agent.ended !== null) return;
    const turnSeq = how === "deleted" || agent.threadId === null ? null : await latestTurnSeq(bb, agent.threadId);
    const { view } = await readIssue(bb, store, { coordinatorId, id: agent.issueId });
    const leftId = leftBy(agent, turnSeq);
    const left = leftId === null ? null : store.handoff(leftId);
    const issue = issueOf(coordinatorId, agent.issueId);
    inbox.endAgent(agent, how, leftId, keepsPlaceAfterEnd(issue, left, view.pr));
    onChange(coordinatorId);
  }

  async function endIfFree(agent: Agent, how: "archived" | "deleted"): Promise<void> {
    await turns.runIfFree(agent.coordinatorId, agent.issueId, () => end(agent, how));
  }

  function agentOf(coordinatorId: CoordinatorId, id: AgentId): Agent {
    const agent = store.agent(coordinatorId, id);
    if (agent === null) throw new Error(`The agent ${id} of ${coordinatorId} is missing.`);
    return agent;
  }

  function issueOf(coordinatorId: CoordinatorId, issueId: IssueId): Issue {
    const issue = store.issue(coordinatorId, issueId);
    if (issue === null) throw new Error(`The issue ${issueId} of ${coordinatorId} is missing.`);
    return issue;
  }

  function remove(id: CoordinatorId): void {
    store.removeCoordinator(id);
    onRemoved(id);
  }

  return {
    start,

    message: ({ coordinatorId, id, issueId }: Agent, text: string): Promise<MessageOutcome | Busy> =>
      turns.run(coordinatorId, issueId, async () => {
        const agent = agentOf(coordinatorId, id);
        if (agent.ended !== null) return { kind: "already-ended", how: agent.ended.how };
        if (agent.threadId === null) return { kind: "unbound" };
        const quieted = await quietIssue(bb, store, coordinatorId, issueId, { kind: "thread", threadId: agent.threadId });
        if (quieted.kind !== "quiet") return { kind: "unquiet", unquiet: quieted };
        const { delivery } = await bb.sdk.threads.send({
          threadId: agent.threadId,
          senderThreadId: coordinatorOf(coordinatorId).threadId,
          mode: "auto",
          input: [{ type: "text", text, mentions: [] }],
        });
        const dropped = store.supersedeOpenChecks(coordinatorId, issueId);
        onChange(coordinatorId);
        return { kind: delivery, dropped };
      }),

    stop: ({ coordinatorId, id, issueId }: Agent, archive: boolean): Promise<StopOutcome | Busy> =>
      turns.run(coordinatorId, issueId, async () => {
        const agent = agentOf(coordinatorId, id);
        if (agent.ended !== null) return { kind: "already-ended", how: agent.ended.how };
        const { threadId } = agent;
        const [unstopped] = threadId === null ? [] : (await stopThreads(bb, [threadId])).unstopped;
        if (unstopped !== undefined) return { kind: "still-running", why: unstopped.why };
        await end(agent, "stopped");
        if (archive && threadId !== null) await bb.sdk.threads.archive({ threadId });
        onChange(coordinatorId);
        return { kind: "stopped", archived: archive && threadId !== null };
      }),

    archived: (agent: Agent) => endIfFree(agent, "archived"),

    async deleted(agent: Agent): Promise<void> {
      const manager = await listed(coordinatorOf(agent.coordinatorId).threadId);
      if (manager === null || manager.deletedAt !== null) return remove(agent.coordinatorId);
      await endIfFree(agent, "deleted");
    },

    remove,

    async reconcile(): Promise<void> {
      for (const coordinator of store.coordinators()) {
        const holders = store.agents(coordinator.id).filter((agent): agent is Agent & { threadId: string } => agent.ended === null && agent.threadId !== null);
        const threads = await threadsById(bb, [coordinator.threadId, ...holders.map(({ threadId }) => threadId)]);
        const manager = threads.get(coordinator.threadId);
        if (manager === undefined || manager.deletedAt !== null) {
          remove(coordinator.id);
          continue;
        }
        for (const agent of holders) {
          const thread = threads.get(agent.threadId);
          const how = thread === undefined || thread.deletedAt !== null ? "deleted" : thread.archivedAt !== null ? "archived" : null;
          if (how !== null) endIfFree(agent, how).catch((error: unknown) => bb.log.warn(`Could not end ${agent.id}, whose thread was ${how}; the next tick tries again: ${messageOf(error)}`));
        }
      }
    },
  };
}

function finalText(issue: Issue, view: IssueView): string | null {
  if (issue.closed !== null) return `${issue.id} is ${issue.closed.as === "canceled" ? "canceled" : "accepted as done"}, so no agent can start on it.`;
  return view.status === "done" ? `${issue.id} is Done (${headlineText(view)}), so no agent can start on it.` : null;
}

const whereText = ({ base, placement }: Spot): string => (base.kind === "joined" ? `${base.from}'s environment` : placementText(placement));

function parentText(issue: Issue, issues: readonly Issue[]): string | null {
  const subIssues = issues.filter(({ parentId }) => parentId === issue.id).map(({ id }) => id);
  return subIssues.length === 0 ? null : `${issue.id} has sub-issues (${subIssues.join(", ")}), and a parent has no agent of its own: start agents on them.`;
}

/** An execution in words: `codex gpt-5.4 (high)`. */
export const executionText = ({ providerId, model, reasoningLevel }: Execution): string => `${providerId} ${model}${reasoningLevel === "" ? "" : ` (${reasoningLevel})`}`;

function placementText(placement: Placement): string {
  switch (placement.kind) {
    case "worktree":
      return "a fresh worktree on your machine";
    case "provider":
      return `a new ${placement.environmentProviderId} environment, read on bb's primary machine`;
    default:
      return placement satisfies never;
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
