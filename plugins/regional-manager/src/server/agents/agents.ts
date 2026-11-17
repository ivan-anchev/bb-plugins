// What a regional manager does to agents: start one on an issue, message one, stop one; and how an
// agent ends, whoever ends it (agent_stop, the user archiving or deleting its thread, the tick
// finding its thread gone). Each action reads the plugin's database and bb, and ends by refreshing
// the board.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Coordinator } from "../../contract.ts";
import { environmentOf, placementOf, type Agent, type AgentId, type EndedHow, type Placement, type PlacementFacts, type RequestedPlacement } from "../../model/agent.ts";
import { catalogRouting, sameModel, type Execution, type RequestedExecution } from "../../model/execution.ts";
import { handoffIsCurrent } from "../../model/handoff.ts";
import { briefToStart, type Issue, type IssueId } from "../../model/issue/issue.ts";
import { keepsPlaceAfterEnd, type IssueView } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import { inheritedFrom, type Inherited, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Inbox } from "../inbox/inbox.ts";
import { readIssue, type FactsBb, type FactsStore } from "../issues/issue-facts.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Spawner } from "../spawn.ts";
import type { Store } from "../store/store.ts";
import { agentBrief } from "./brief.ts";
import { isLive, latestTurnSeq, threadsById, type ListBb } from "./threads.ts";

type Threads = BbPluginApi["sdk"]["threads"];

/** An agent's or a regional manager's thread as the agents read it. */
type ListedThread = { id: string; providerId: string; status: string; environmentHostId: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb agent actions use, down to the fields they read. */
type AgentsBb = CatalogBb &
  ThreadExecutionBb &
  FactsBb &
  ListBb<ListedThread> & {
    sdk: {
      threads: {
        send(args: Parameters<Threads["send"]>[0]): Promise<{ delivery: "sent" | "queued" }>;
        stop(args: { threadId: string }): Promise<unknown>;
        archive(args: { threadId: string }): Promise<unknown>;
      };
    };
  };

/** What agent_start asks for: the issue, and optionally what the agent runs on and where. */
type StartRequest = { issueId: IssueId; execution?: RequestedExecution; placement?: RequestedPlacement };

/** What an agent runs on: the execution named, or (`inherited`) its regional manager's own, with the service tier its spawn carries beside it. */
type RunsOn = { execution: Execution; inherited: Pick<Inherited, "serviceTier"> | null };

/** What a start did: refused before anything changed; started, on `execution` (`inherited`: the regional manager's own); or inserted and then refused by bb. */
export type StartOutcome =
  | { kind: "refused"; reason: string }
  | { kind: "started"; agentId: AgentId; threadId: string; execution: Execution; inherited: boolean }
  | { kind: "failed"; agentId: AgentId; error: string };

/** What a stop did. An agent ends as stopped only once bb no longer runs its thread. */
export type StopOutcome = { kind: "stopped"; archived: boolean } | { kind: "already-ended"; how: EndedHow } | { kind: "still-running"; status: string };

type Deps = {
  bb: AgentsBb;
  store: FactsStore & Pick<Store, "coordinator" | "coordinators" | "issue" | "agent" | "insertAgent" | "agentTicket" | "removeCoordinator">;
  spawner: Pick<Spawner, "agent">;
  inbox: Pick<Inbox, "endAgent">;
  memory: MemoryRoot;
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

export function createAgents({ bb, store, spawner, inbox, memory, placementFacts, onChange, onRemoved }: Deps) {
  function coordinatorOf(id: CoordinatorId): Coordinator {
    const coordinator = store.coordinator(id);
    // why throw: a tool resolves the caller's role from a bound thread, so its regional manager is bound.
    if (coordinator === null) throw new Error(`The regional manager ${id} has no thread.`);
    return coordinator;
  }

  async function listed(threadId: string): Promise<ListedThread | null> {
    return (await threadsById(bb, [threadId])).get(threadId) ?? null;
  }

  /**
   * What the agent runs on: the execution named, resolved against bb's catalog where it will run;
   * else the regional manager's own as it is now. why not leave it to bb: bb gives a child its
   * parent's only while that provider is available and the parent has a turn on record.
   */
  async function executionFor(coordinator: Coordinator, requested: RequestedExecution | undefined, placement: Placement, environment: ReturnType<typeof environmentOf>): Promise<RunsOn | { refused: string }> {
    if (requested === undefined) {
      const own = await inheritedFrom(bb, coordinator.threadId);
      return own === null ? { refused: "bb has no model on record for you yet, so the agent has none to inherit. Name one with execution." } : { execution: own.execution, inherited: { serviceTier: own.serviceTier } };
    }
    const resolved = await resolvedExecution(bb, catalogRouting(environment), requested);
    if ("refused" in resolved) return { refused: `Nothing started. Where the agent would run (${placementText(placement)}): ${resolved.refused}` };
    return { execution: resolved, inherited: null };
  }

  async function start(coordinatorId: CoordinatorId, { issueId, execution: requested, placement: requestedPlacement }: StartRequest): Promise<StartOutcome> {
    const refused = (reason: string): StartOutcome => ({ kind: "refused", reason });
    const coordinator = coordinatorOf(coordinatorId);
    const filed = store.issue(coordinatorId, issueId);
    if (filed === null) return refused(`You have no issue ${issueId}. crew_catch_up lists your issues.`);
    const holder = holderOf(coordinatorId, filed.id);
    if (holder !== null) return refused(heldText(holder.id, filed.id));
    const placement = requestedPlacement === undefined ? WORKTREE : placementOf(requestedPlacement, await placementFacts(coordinatorId));
    if ("refused" in placement) return refused(placement.refused);
    const manager = await listed(coordinator.threadId);
    // why its machine: a worktree agent gets its fresh worktree there, as a child of a live thread does from bb.
    const environment = environmentOf(placement, manager?.environmentHostId ?? null);
    const runsOn = await executionFor(coordinator, requested, placement, environment);
    if ("refused" in runsOn) return refused(runsOn.refused);
    const { view } = await readIssue(bb, store, filed);
    // why read the issue again here, with no await before the insert: the manager may have closed it,
    // changed its plan or named its verifier meanwhile (insertAgent sees another agent started).
    const issue = issueOf(coordinatorId, filed.id);
    const final = finalText(issue, view);
    if (final !== null) return refused(final);
    const planned = briefToStart(issue);
    if ("refused" in planned) return refused(planned.refused);
    const { execution } = runsOn;
    if (issue.verifier !== null && sameModel(issue.verifier, execution)) {
      return refused(
        `${issue.id}'s verifier is ${executionText(issue.verifier)}, so an agent on ${runsOn.inherited === null ? "it" : "your own model"} couldn't be checked by another model. Name another execution, or change ${issue.id}'s verifier with issue_update.`,
      );
    }
    const ticket = randomUUID();
    const agentId = store.insertAgent({ coordinatorId, issueId: issue.id, ticket, placement, base: { kind: "default" }, execution, at: Date.now() });
    if (agentId === null) return refused(heldText(holderOf(coordinatorId, issue.id)?.id ?? "another agent", issue.id));
    const started = (threadId: string): StartOutcome => ({ kind: "started", agentId, threadId, execution, inherited: runsOn.inherited !== null });
    onChange(coordinatorId);
    const files = memory.of(coordinatorId);
    try {
      const prompt = agentBrief(agentId, { ...issue, brief: planned.brief }, { crewRules: files.read(CREW_RULES).text, index: files.read(MEMORY_INDEX).text });
      const threadId = await spawner.agent(ticket, { coordinator, title: issue.title, environment, execution, serviceTier: runsOn.inherited?.serviceTier ?? null, prompt });
      return started(threadId);
    } catch (error) {
      // why read again: bb may have made the thread and bound it through thread.created, with only its answer lost.
      const threadId = store.agent(coordinatorId, agentId)?.threadId ?? null;
      if (threadId !== null) return started(threadId);
      inbox.endAgent({ coordinatorId, id: agentId, issueId: issue.id }, "spawn-failed", null, false);
      return { kind: "failed", agentId, error: error instanceof Error ? error.message : String(error) };
    } finally {
      onChange(coordinatorId);
    }
  }

  function holderOf(coordinatorId: CoordinatorId, issueId: IssueId): Agent | null {
    return store.agents(coordinatorId).find((agent) => agent.issueId === issueId && agent.ended === null) ?? null;
  }

  /**
   * Ends the agent as `how`, with the handoff it leaves: its current one, or for a deleted thread,
   * whose turns can't be read, its latest. Its issue returns to Todo, and its regional manager is
   * told, unless the issue keeps its place (keepsPlaceAfterEnd): closed, merged, or placed by that
   * handoff. why bb first and the store right after, with no await between: a handoff the agent
   * makes meanwhile, or the manager closing the issue, is seen.
   */
  async function end(agent: Agent, how: Exclude<EndedHow, "spawn-failed">): Promise<void> {
    if (agent.ended !== null) return;
    const turnSeq = how === "deleted" || agent.threadId === null ? null : await latestTurnSeq(bb, agent.threadId);
    const { view } = await readIssue(bb, store, { coordinatorId: agent.coordinatorId, id: agent.issueId });
    const latest = store.latestHandoff(agent.coordinatorId, agent.id);
    const left = latest !== null && handoffIsCurrent(latest.handoff, turnSeq) ? latest : null;
    const issue = issueOf(agent.coordinatorId, agent.issueId);
    inbox.endAgent(agent, how, left?.handoff.id ?? null, keepsPlaceAfterEnd(issue, left, view.pr));
    onChange(agent.coordinatorId);
  }

  /** why throw: an agent is inserted on an issue of its regional manager, and issues are never deleted. */
  function issueOf(coordinatorId: CoordinatorId, issueId: IssueId): Issue {
    const issue = store.issue(coordinatorId, issueId);
    if (issue === null) throw new Error(`The issue ${issueId} of ${coordinatorId} is missing.`);
    return issue;
  }

  /** Removes a regional manager whose thread bb deleted, with everything it owns. */
  function remove(id: CoordinatorId): void {
    store.removeCoordinator(id);
    onRemoved(id);
  }

  return {
    start,

    /** Sends the text as a message from the regional manager: it steers a running turn or starts one. */
    async message(agent: Agent & { threadId: string }, text: string): Promise<"sent" | "queued"> {
      const { delivery } = await bb.sdk.threads.send({
        threadId: agent.threadId,
        senderThreadId: coordinatorOf(agent.coordinatorId).threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
      onChange(agent.coordinatorId);
      return delivery;
    },

    /** Stops the agent's turn and ends it once bb no longer runs its thread; then archives its thread when asked. Never archives otherwise. */
    async stop(agent: Agent, archive: boolean): Promise<StopOutcome> {
      if (agent.ended !== null) return { kind: "already-ended", how: agent.ended.how };
      const { threadId } = agent;
      if (threadId !== null) {
        await bb.sdk.threads.stop({ threadId });
        // why read again: bb's stop can leave the thread stopping, and an agent ends only once its thread no longer runs.
        const thread = await listed(threadId);
        if (thread !== null && isLive(thread) && thread.status !== "idle" && thread.status !== "error") return { kind: "still-running", status: thread.status };
      }
      await end(agent, "stopped");
      if (archive && threadId !== null) await bb.sdk.threads.archive({ threadId });
      onChange(agent.coordinatorId);
      return { kind: "stopped", archived: archive && threadId !== null };
    },

    /** The user archived the agent's thread in bb. */
    archived: (agent: Agent) => end(agent, "archived"),

    /**
     * bb deleted the agent's thread. If its regional manager's thread is gone too, bb is deleting
     * the manager, which deletes its agents with it: the manager is removed instead, whichever
     * thread's event comes first, so nothing is told to a thread that no longer exists.
     */
    async deleted(agent: Agent): Promise<void> {
      const manager = await listed(coordinatorOf(agent.coordinatorId).threadId);
      if (manager === null || manager.deletedAt !== null) return remove(agent.coordinatorId);
      await end(agent, "deleted");
    },

    remove,

    /**
     * The tick's pass: removes every regional manager bb deleted, and ends every agent whose thread bb
     * archived or deleted, for events missed while the plugin wasn't listening.
     */
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
          if (thread === undefined || thread.deletedAt !== null) await end(agent, "deleted");
          else if (thread.archivedAt !== null) await end(agent, "archived");
        }
      }
    },
  };
}

/** Why no agent can start on the issue: the manager closed it, or a merge made it Done (`view`: as read just now); null when one can. */
function finalText(issue: Issue, view: IssueView): string | null {
  if (issue.closed !== null) return `${issue.id} is ${issue.closed.as === "canceled" ? "canceled" : "accepted as done"}, so no agent can start on it.`;
  return view.status === "done" ? `${issue.id} is Done (${view.headline}), so no agent can start on it.` : null;
}

const heldText = (holder: string, issueId: IssueId): string => `${holder} holds ${issueId}. An issue has one agent at a time: stop ${holder} with agent_stop first.`;

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
