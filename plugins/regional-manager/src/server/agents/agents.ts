// What a regional manager does to agents: start one on an issue, message one, stop one; and how an
// agent ends, whoever ends it (agent_stop, the user archiving or deleting its thread, the tick
// finding its thread gone). Each action reads the plugin's database and bb, and ends by refreshing
// the board.
import { randomUUID } from "node:crypto";
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { Coordinator } from "../../contract.ts";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import {
  branchOf,
  environmentOf,
  handoverOf,
  placementOf,
  type Agent,
  type AgentCheckout,
  type AgentId,
  type Base,
  type EndedHow,
  type Handover,
  type Placement,
  type PlacementFacts,
  type Previous,
  type RequestedPlacement,
  type StartFrom,
} from "../../model/agent.ts";
import { catalogRouting, sameModel, type Execution, type RequestedExecution } from "../../model/execution.ts";
import { handoffIsCurrent, type HandoffId } from "../../model/handoff.ts";
import { briefToStart, type Issue, type IssueId } from "../../model/issue/issue.ts";
import { keepsPlaceAfterEnd, type IssueView } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import { inheritedFrom, type Inherited, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Inbox } from "../inbox/inbox.ts";
import { readIssue, type FactsBb, type FactsStore } from "../issues/issue-facts.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Spawner } from "../spawn.ts";
import type { NewAgent } from "../store/issue/agents-store.ts";
import type { Store } from "../store/store.ts";
import { agentBrief } from "./brief.ts";
import { environmentGone, type EnvironmentsBb } from "./environments.ts";
import { latestTurnSeq, stopRunning, threadsById, type ListBb, type StopBb } from "./threads.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type QueuedMessage = Awaited<ReturnType<Threads["queuedMessages"]["list"]>>[number];
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
  ThreadExecutionBb &
  FactsBb &
  EnvironmentsBb &
  StopBb &
  ListBb<ListedThread> & {
    log: Pick<PluginLogger, "warn">;
    sdk: {
      threads: {
        send(args: Parameters<Threads["send"]>[0]): Promise<{ delivery: "sent" | "queued" }>;
        archive(args: { threadId: string }): Promise<unknown>;
        queuedMessages: {
          list(args: { threadId: string }): Promise<Pick<QueuedMessage, "id" | "senderThreadId" | "state" | "content">[]>;
          delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown>;
        };
      };
    };
  };

/** What agent_start asks for: the issue, whether a handover continues the previous agent's work or starts clean, and optionally what the agent runs on and where. */
type StartRequest = { issueId: IssueId; from: StartFrom; execution?: RequestedExecution; placement?: RequestedPlacement };

/** What an agent runs on: the execution named, or (`inherited`) its regional manager's own, with the service tier its spawn carries beside it. */
type RunsOn = { execution: Execution; inherited: Pick<Inherited, "serviceTier"> | null };

/** Where a start spawns the agent: its placement, its environment, where its work starts and what it inherits there. */
type Spot = { placement: Placement; environment: EnvironmentArgs; base: Base; checkout: AgentCheckout };

/** A start decided: its issue, where it spawns, what it runs on, and the issue's previous agent (null: none). */
type Decided = { issueId: IssueId; spot: Spot; runsOn: RunsOn; after: AgentId | null };

/**
 * The issue taken over: as it was when the new agent was inserted, with the brief it starts from,
 * the agent, its ticket, the holder it replaced (null: none) and the regional manager's messages to
 * that holder it took back from bb's queue, which the holder never got.
 */
type Taken = { issue: Issue; brief: string; agentId: AgentId; ticket: string; replaced: AgentId | null; withdrawn: string[] };

/** The previous agent's environment a new agent joined: whose, what made it, its branch and its pull request's number (null: none known). */
export type Joined = { from: AgentId; placement: Placement; branch: string | null; pr: number | null };

/**
 * Where a start stands in its issue's succession of agents: `after`, the issue's previous agent (null: the first);
 * `replaced`, the agent it stopped and replaced (null: none held the issue), with `withdrawn`, the
 * regional manager's messages to it taken back from bb's queue; `joined`, the environment it joined
 * (null: a clean start).
 */
type Succession = { after: AgentId | null; replaced: AgentId | null; withdrawn: string[]; joined: Joined | null };

/** What a start did: refused before anything changed; started, on `execution` (`inherited`: the regional manager's own); or inserted and then refused by bb. */
export type StartOutcome =
  | { kind: "refused"; reason: string }
  | ({ kind: "started"; agentId: AgentId; threadId: string; execution: Execution; inherited: boolean } & Succession)
  | ({ kind: "failed"; agentId: AgentId; error: string } & Succession);

/** What a stop did. An agent ends as stopped only once bb confirms its thread no longer runs; `why` it hasn't: the status bb still reports, or bb's error that left the stop unconfirmed. */
export type StopOutcome = { kind: "stopped"; archived: boolean } | { kind: "already-ended"; how: EndedHow } | { kind: "still-running"; why: string };

/** What a message did: sent or queued by bb; or nothing, as the agent ended or has no thread yet. */
export type MessageOutcome = { kind: "sent" | "queued" | "unbound" } | { kind: "already-ended"; how: EndedHow };

type Deps = {
  bb: AgentsBb;
  store: FactsStore & Pick<Store, "coordinator" | "coordinators" | "issue" | "agent" | "issueThreads" | "insertAgent" | "replaceAgent" | "record" | "agentTicket" | "removeCoordinator">;
  spawner: Pick<Spawner, "agent">;
  inbox: Pick<Inbox, "endAgent">;
  memory: MemoryRoot;
  turns: IssueTurns;
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

export function createAgents({ bb, store, spawner, inbox, memory, turns, placementFacts, onChange, onRemoved }: Deps) {
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
   * What the agent runs on: the execution named, resolved against bb's catalog where it will run
   * (`where`, in words); else the regional manager's own as it is now, on a handover too. why not
   * leave it to bb: bb gives a child its parent's only while that provider is available and the
   * parent has a turn on record. why never the previous agent's: it may be why that agent is replaced.
   */
  async function executionFor(coordinator: Coordinator, requested: RequestedExecution | undefined, environment: EnvironmentArgs, where: string): Promise<RunsOn | { refused: string }> {
    if (requested === undefined) {
      const own = await inheritedFrom(bb, coordinator.threadId);
      return own === null ? { refused: "bb has no model on record for you yet, so the agent has none to inherit. Name one with execution." } : { execution: own.execution, inherited: { serviceTier: own.serviceTier } };
    }
    const resolved = await resolvedExecution(bb, catalogRouting(environment), requested);
    if ("refused" in resolved) return { refused: `Nothing changed. Where the agent would run (${where}): ${resolved.refused}` };
    return { execution: resolved, inherited: null };
  }

  /**
   * The issue's latest agent that had a thread, with its environment while bb hasn't destroyed it
   * and its branch. Reads bb, never the environment itself: a read of a suspended sandbox fails
   * without waking it (SH5), and a join inherits whatever is there. The environment is the one its
   * handoffs recorded or it inherited, else its thread's, an archived thread's included.
   */
  async function previousOf(coordinatorId: CoordinatorId, issueId: IssueId): Promise<Previous | null> {
    const agent = store
      .agents(coordinatorId)
      .filter((each) => each.issueId === issueId && each.threadId !== null)
      .at(-1);
    if (agent === undefined || agent.threadId === null) return null;
    const thread = await listed(agent.threadId);
    const known = agent.checkout.environmentId ?? thread?.environmentId ?? null;
    const environmentId = known !== null && !(await environmentGone(bb, known)) ? known : null;
    return { agent, environmentId, branch: branchOf(agent, thread) };
  }

  /** Where a start spawns: in the previous agent's environment for a join; else where the placement named says, a worktree on the regional manager's machine by default. */
  async function spotOf(coordinatorId: CoordinatorId, handover: Handover, requested: RequestedPlacement | undefined): Promise<Spot | { refused: string }> {
    if (handover.kind === "join") return handover;
    const placement = requested === undefined ? WORKTREE : placementOf(requested, await placementFacts(coordinatorId));
    if ("refused" in placement) return placement;
    const manager = await listed(coordinatorOf(coordinatorId).threadId);
    // why its machine: a worktree agent gets its fresh worktree there, as a child of a live thread does from bb.
    return { placement, environment: environmentOf(placement, manager?.environmentHostId ?? null), base: { kind: "default" }, checkout: NO_CHECKOUT };
  }

  /**
   * The issue as the store has it now, with the brief its agent starts from, or why no agent can
   * start on it (`view`: as read just now). Call with no await before the write it allows.
   */
  function startable(coordinatorId: CoordinatorId, issueId: IssueId, view: IssueView, { execution, inherited }: RunsOn): { issue: Issue; brief: string } | { refused: string } {
    const issue = issueOf(coordinatorId, issueId);
    const final = finalText(issue, view);
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

  /**
   * Starts an agent on the issue; a handover when the issue has or had one. It runs as its issue's
   * turn (issue-turns.ts), so it decides on facts no other operation on the issue changes before it
   * is done. The order keeps a sandbox alive, where nothing waits once the last live thread is
   * archived (SH5):
   * 1. decide where it runs and on what, from what bb has now; a refusal changes nothing;
   * 2. quiet the issue: take back what the plugin queued for the holder, then stop every thread the
   *    plugin started for the issue that bb reports running, and confirm each, never archiving one:
   *    a stopped thread keeps its environment (SH1 (b), SH5). Anything bb doesn't confirm refuses
   *    the start, holder and record intact;
   * 3. end the holder as replaced, supersede the issue's open checks and insert the new agent, together;
   * 4. spawn: a reuse wakes a suspended sandbox and keeps a retiring worktree (SH1). bb refusing it,
   *    as for an environment removed since step 1, ends the new agent as spawn-failed.
   */
  function start(coordinatorId: CoordinatorId, request: StartRequest): Promise<StartOutcome | Busy> {
    return turns.run(coordinatorId, request.issueId, async () => {
      const decided = await decide(coordinatorId, request);
      if ("refused" in decided) return { kind: "refused", reason: decided.refused };
      const taken = await takeOver(coordinatorId, decided);
      if ("refused" in taken) return { kind: "refused", reason: taken.refused };
      return spawn(coordinatorId, decided, taken);
    });
  }

  /** Step 1: where the agent starts and what it runs on, from what bb and the store have now; changes nothing. */
  async function decide(coordinatorId: CoordinatorId, { issueId, from, execution, placement }: StartRequest): Promise<Decided | { refused: string }> {
    const filed = store.issue(coordinatorId, issueId);
    if (filed === null) return { refused: `You have no issue ${issueId}. crew_catch_up lists your issues.` };
    const previous = await previousOf(coordinatorId, filed.id);
    const handover = handoverOf(filed.kind, { from, placement }, previous);
    if ("refused" in handover) return { refused: `Nothing changed. ${handover.refused}` };
    const spot = await spotOf(coordinatorId, handover, placement);
    if ("refused" in spot) return spot;
    const runsOn = await executionFor(coordinatorOf(coordinatorId), execution, spot.environment, whereText(spot));
    if ("refused" in runsOn) return runsOn;
    const ready = startable(coordinatorId, filed.id, (await readIssue(bb, store, filed)).view, runsOn);
    if ("refused" in ready) return ready;
    return { issueId: filed.id, spot, runsOn, after: previous?.agent.id ?? null };
  }

  /**
   * Steps 2 and 3: quiets the issue (see quiet), then gives it to the new agent. Refused when
   * quieting is, and when the issue can no longer start an agent or changed hands meanwhile, saying
   * what quieting did.
   */
  async function takeOver(coordinatorId: CoordinatorId, { issueId, spot, runsOn }: Decided): Promise<Taken | { refused: string }> {
    const holder = holderOf(coordinatorId, issueId);
    const quieted = await quiet(coordinatorId, issueId, holder);
    if ("refused" in quieted) return quieted;
    const turnSeq = holder === null || holder.threadId === null ? null : await latestTurnSeq(bb, holder.threadId);
    // why decide again here, with no await from here to the write: while the issue quieted, a merge
    // may have made it Done.
    const now = startable(coordinatorId, issueId, (await readIssue(bb, store, { coordinatorId, id: issueId })).view, runsOn);
    if ("refused" in now) return { refused: `${quieted.did}${now.refused}` };
    const next: NewAgent = { coordinatorId, issueId, ticket: randomUUID(), ...spot, execution: runsOn.execution, at: Date.now() };
    const agentId = holder === null ? store.insertAgent(next) : store.replaceAgent(holder, leftBy(holder, turnSeq), next);
    if (agentId === null) return { refused: `${quieted.did}${issueId} changed hands meanwhile. crew_catch_up shows who holds it now.` };
    return { ...now, agentId, ticket: next.ticket, replaced: holder?.id ?? null, withdrawn: quieted.withdrawn };
  }

  /**
   * Quiets the issue before a new agent starts on it: takes back what the plugin queued for the
   * holder (see withdrawQueued), then stops every thread the plugin started for the issue that bb
   * reports running, the holder's, its verifiers' and any earlier agent's, and confirms each. why
   * ask bb, not the record: a thread runs or not whatever the plugin last wrote about it. Returns
   * the manager's messages it took back, and what it did in words (`did`), to lead a refusal that
   * follows; else why the start is refused, with what it did.
   */
  async function quiet(coordinatorId: CoordinatorId, issueId: IssueId, holder: Agent | null): Promise<{ withdrawn: string[]; did: string } | { refused: string }> {
    const threads = store.issueThreads(coordinatorId, issueId);
    const named = (threadId: string): string => threads.find((thread) => thread.threadId === threadId)?.agentId ?? `the verifier @thread:${threadId}`;
    const holderThread = holder === null ? null : holder.threadId;
    const { withdrawn, left } = holderThread === null ? { withdrawn: [], left: [] } : await withdrawQueued(holderThread, coordinatorOf(coordinatorId).threadId, threads);
    const { stopped, unstopped } = left.length > 0 ? { stopped: [], unstopped: [] } : await stopRunning(bb, threads.map(({ threadId }) => threadId));
    const did = didText(holder?.id ?? null, withdrawn, stopped.map(named));
    const holds = holder === null ? "" : ` and ${holder.id} still holds ${issueId}`;
    if (left.length > 0) {
      return { refused: `${did}bb still has ${left.join(", and ")} queued for ${holder?.id}, which would wake it once stopped, and couldn't take it back, so no agent started${holds}. Call agent_start again once bb has sent or deleted it.` };
    }
    if (unstopped.length > 0) {
      const running = unstopped.map(({ threadId, why }) => `${named(threadId)} ${why}`).join(", and ");
      return { refused: `${did}${running}, so no agent started${holds}. Call agent_start again once it has stopped.` };
    }
    return { withdrawn, did: did === "" ? "" : `${did}nothing else changed: ` };
  }

  /**
   * Takes back the messages the plugin's tools queued in bb for the holder's thread, which bb would
   * send once its turn stops: the regional manager's (`managerThreadId`) and its verifiers' findings,
   * as bb names their sender. Then reads the queue again, and returns, in words, everything still
   * there that bb would send (`left`), a message someone else queued included, and the manager's
   * messages bb deleted, whose text the holder never got (`withdrawn`). why read again, not trust a
   * delete's answer: bb refuses one for a message it sent meanwhile and fails one it never reached
   * alike. One bb sent meanwhile reached the holder, and the stop after this ends the turn it started.
   */
  async function withdrawQueued(threadId: string, managerThreadId: string, threads: { threadId: string }[]): Promise<{ withdrawn: string[]; left: string[] }> {
    const ours = new Set([managerThreadId, ...threads.map((thread) => thread.threadId)]);
    const queue = bb.sdk.threads.queuedMessages;
    const mine = (await queue.list({ threadId })).filter((message) => bbSends(message) && message.senderThreadId !== null && ours.has(message.senderThreadId));
    const deleted = await Promise.all(mine.map(({ id }) => queue.delete({ threadId, queuedMessageId: id }).then(() => true, () => false)));
    const sender = (senderThreadId: string | null): string =>
      senderThreadId === managerThreadId ? "your message" : senderThreadId === null ? "a message from the user" : ours.has(senderThreadId) ? `findings from the verifier @thread:${senderThreadId}` : `a message from @thread:${senderThreadId}`;
    return {
      withdrawn: mine.filter(({ senderThreadId }, i) => deleted[i] && senderThreadId === managerThreadId).map(({ content }) => content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")),
      left: (await queue.list({ threadId })).filter(bbSends).map(({ senderThreadId }) => sender(senderThreadId)),
    };
  }

  /** Step 4: spawns the inserted agent's thread with its first message; one bb refuses ends as spawn-failed. */
  async function spawn(coordinatorId: CoordinatorId, { spot, runsOn, after }: Decided, { issue, brief, agentId, ticket, replaced, withdrawn }: Taken): Promise<StartOutcome> {
    const { execution, inherited } = runsOn;
    const succession: Succession = { after, replaced, withdrawn, joined: joinedOf(coordinatorId, spot) };
    const started = (threadId: string): StartOutcome => ({ kind: "started", agentId, threadId, execution, inherited: inherited !== null, ...succession });
    onChange(coordinatorId);
    const files = memory.of(coordinatorId);
    try {
      const prompt = agentBrief(
        agentId,
        { ...issue, brief },
        { base: spot.base, branch: spot.checkout.branch, pr: succession.joined?.pr ?? null, earlier: store.record(coordinatorId, issue.id) },
        { crewRules: files.read(CREW_RULES).text, index: files.read(MEMORY_INDEX).text },
      );
      return started(await spawner.agent(ticket, { coordinator: coordinatorOf(coordinatorId), title: issue.title, environment: spot.environment, execution, serviceTier: inherited?.serviceTier ?? null, prompt }));
    } catch (error) {
      // why read again: bb may have made the thread and bound it through thread.created, with only its answer lost.
      const threadId = store.agent(coordinatorId, agentId)?.threadId ?? null;
      if (threadId !== null) return started(threadId);
      inbox.endAgent({ coordinatorId, id: agentId, issueId: issue.id }, "spawn-failed", null, false);
      return { kind: "failed", agentId, error: error instanceof Error ? error.message : String(error), ...succession };
    } finally {
      onChange(coordinatorId);
    }
  }

  /** The handoff the agent leaves as it ends: its latest, while its thread (`turnSeq`: its latest turn) has started none since. Read from the store, with no await before the write it goes into. */
  function leftBy(agent: Agent, turnSeq: number | null): HandoffId | null {
    const latest = store.latestHandoff(agent.coordinatorId, agent.id);
    return latest !== null && handoffIsCurrent(latest.handoff, turnSeq) ? latest.handoff.id : null;
  }

  /** The previous agent's environment a start joins, with its pull request's number while open as last read; null for a clean start. */
  function joinedOf(coordinatorId: CoordinatorId, { base, placement, checkout: { branch } }: Spot): Joined | null {
    if (base.kind !== "joined") return null;
    const pr = branch === null ? null : (store.prOfBranch(coordinatorId, branch)?.snapshot ?? null);
    return { from: base.from, placement, branch, pr: pr?.state === "open" ? pr.number : null };
  }

  function holderOf(coordinatorId: CoordinatorId, issueId: IssueId): Agent | null {
    return store.agents(coordinatorId).find((agent) => agent.issueId === issueId && agent.ended === null) ?? null;
  }

  /**
   * Ends the agent as `how`, in its issue's turn, with the handoff it leaves: its current one, or for
   * a deleted thread, whose turns can't be read, its latest. Its issue returns to Todo, and its
   * regional manager is told, unless the issue keeps its place (keepsPlaceAfterEnd): closed, merged,
   * or placed by that handoff. why bb first and the store right after, with no await between: the
   * manager closing the issue meanwhile is seen.
   */
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

  /**
   * Ends an agent whose thread bb archived or deleted, unless its issue's turn is taken; then the
   * tick's next pass does, as it does for any event missed. why not wait: bb already stopped the
   * thread, so nothing runs meanwhile.
   */
  async function endIfFree(agent: Agent, how: "archived" | "deleted"): Promise<void> {
    await turns.runIfFree(agent.coordinatorId, agent.issueId, () => end(agent, how));
  }

  /** The agent as stored now. why throw: a tool resolved it from the store, and agents are kept while their regional manager is. */
  function agentOf(coordinatorId: CoordinatorId, id: AgentId): Agent {
    const agent = store.agent(coordinatorId, id);
    if (agent === null) throw new Error(`The agent ${id} of ${coordinatorId} is missing.`);
    return agent;
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

    /**
     * Sends the text as a message from the regional manager: it steers a running turn, starts one,
     * or waits in bb's queue. In its issue's turn, to an agent that still holds it, so a handover
     * never has it wake the agent it replaced; a handover takes back one still waiting in the queue.
     */
    message: ({ coordinatorId, id, issueId }: Agent, text: string): Promise<MessageOutcome | Busy> =>
      turns.run(coordinatorId, issueId, async () => {
        const agent = agentOf(coordinatorId, id);
        if (agent.ended !== null) return { kind: "already-ended", how: agent.ended.how };
        if (agent.threadId === null) return { kind: "unbound" };
        const { delivery } = await bb.sdk.threads.send({
          threadId: agent.threadId,
          senderThreadId: coordinatorOf(coordinatorId).threadId,
          mode: "auto",
          input: [{ type: "text", text, mentions: [] }],
        });
        onChange(coordinatorId);
        return { kind: delivery };
      }),

    /**
     * Stops the agent's turn and ends it once bb no longer runs its thread; then archives its thread
     * when asked, which destroys a sandbox no other thread lives in. Never archives otherwise. In its
     * issue's turn, so an agent a handover replaced meanwhile is already ended, and its thread, now
     * its successor's environment, is never archived.
     */
    stop: ({ coordinatorId, id, issueId }: Agent, archive: boolean): Promise<StopOutcome | Busy> =>
      turns.run(coordinatorId, issueId, async () => {
        const agent = agentOf(coordinatorId, id);
        if (agent.ended !== null) return { kind: "already-ended", how: agent.ended.how };
        const { threadId } = agent;
        const [unstopped] = threadId === null ? [] : (await stopRunning(bb, [threadId])).unstopped;
        if (unstopped !== undefined) return { kind: "still-running", why: unstopped.why };
        await end(agent, "stopped");
        if (archive && threadId !== null) await bb.sdk.threads.archive({ threadId });
        onChange(coordinatorId);
        return { kind: "stopped", archived: archive && threadId !== null };
      }),

    /** The user archived the agent's thread in bb. */
    archived: (agent: Agent) => endIfFree(agent, "archived"),

    /**
     * bb deleted the agent's thread. If its regional manager's thread is gone too, bb is deleting
     * the manager, which deletes its agents with it: the manager is removed instead, whichever
     * thread's event comes first, so nothing is told to a thread that no longer exists.
     */
    async deleted(agent: Agent): Promise<void> {
      const manager = await listed(coordinatorOf(agent.coordinatorId).threadId);
      if (manager === null || manager.deletedAt !== null) return remove(agent.coordinatorId);
      await endIfFree(agent, "deleted");
    },

    remove,

    /**
     * The tick's pass: removes every regional manager bb deleted, and ends every agent whose thread bb
     * archived or deleted, for events missed while the plugin wasn't listening. why it doesn't wait
     * for the ends: each runs in its issue's turn, if free, and a call bb never answers there must
     * not hold up the tick's other passes.
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
          const how = thread === undefined || thread.deletedAt !== null ? "deleted" : thread.archivedAt !== null ? "archived" : null;
          if (how !== null) endIfFree(agent, how).catch((error: unknown) => bb.log.warn(`Could not end ${agent.id}, whose thread was ${how}; the next tick tries again: ${messageOf(error)}`));
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

/** Where the agent would run, in words, for a refusal of what it would run on. */
const whereText = ({ base, placement }: Spot): string => (base.kind === "joined" ? `${base.from}'s environment` : placementText(placement));

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

/** What quieting an issue did before a refusal, in words that lead it ("" when nothing). */
function didText(holder: AgentId | null, withdrawn: readonly string[], stopped: readonly string[]): string {
  const took = withdrawn.length === 0 ? [] : [`took back ${withdrawn.length === 1 ? "your message" : `your ${withdrawn.length} messages`} to ${holder}, which it never got`];
  const did = [...took, ...(stopped.length === 0 ? [] : [`stopped ${stopped.join(" and ")}`])].join(" and ");
  return did === "" ? "" : `${did.charAt(0).toUpperCase()}${did.slice(1)}, but `;
}

/** Whether bb sends a queued message on its own: every one but a message whose retries bb spent, which waits for the user. */
const bbSends = ({ state }: { state: string }): boolean => state !== "failed_exhausted";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
