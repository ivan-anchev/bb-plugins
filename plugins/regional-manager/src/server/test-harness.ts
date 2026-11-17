// Tests only: the server's modules wired as server.ts wires them, over an in-memory database, a
// temporary memory folder and a fake bb that records what the plugin registers.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolResult, PluginStorage, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { createFakePluginHost, type FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import type { EnvironmentProvider } from "../model/agent.ts";
import type { HolderThread } from "../model/issue/status.ts";
import type { CoordinatorId } from "../model/role.ts";
import { registerAgentTools } from "./agents/agent-tools.ts";
import { createAgents } from "./agents/agents.ts";
import { placementFactsReader } from "./agents/environments.ts";
import { forwardThreadEvents } from "./agents/thread-events.ts";
import type { TurnsBb } from "./agents/threads.ts";
import { boardHandlers } from "./board/board-rpc.ts";
import { createBoard } from "./board/board.ts";
import type { CatalogBb } from "./execution/catalog.ts";
import { createInbox } from "./inbox/inbox.ts";
import { watchOwnTree } from "./inbox/own-tree-watch.ts";
import { watchAgentThreads } from "./inbox/thread-watch.ts";
import { registerIssueTools } from "./issues/issue-tools.ts";
import { issueTurns } from "./issues/issue-turns.ts";
import { createIssues } from "./issues/issues.ts";
import { currentViews } from "./issues/views/current-views.ts";
import { pluginInstance } from "./lifetime.ts";
import { watchUnblocked } from "./issues/views/unblocked.ts";
import { openMemoryRoot } from "./memory/memory-files.ts";
import { memoryHandlers } from "./memory/memory-rpc.ts";
import { memoryStorage } from "./memory-storage.ts";
import { registerRoles } from "./roles.ts";
import { createSpawner } from "./spawn.ts";
import { openStore } from "./store/store.ts";
import { registerCrewTools } from "./tools/crew-tools.ts";
import { registerHandoffTool } from "./tools/handoff-tool.ts";
import type { ToolsBb } from "./tools/tool-kit.ts";
import { registerVerdictTool } from "./verify/verdict-tool.ts";
import { createVerify } from "./verify/verify.ts";
import { createPrWatch } from "./watch/pr-watch.ts";

const PLUGIN_ID = "regional-manager";

// As bb lists them (schemas shortened): boat-sandbox composes project-checkout with a machine of its own.
const ENVIRONMENT_PROVIDERS: EnvironmentProvider[] = [
  { id: "project-checkout", inputs: { type: "object" }, acceptsEmptyInputs: true, machineProviderId: null },
  { id: "personal-workspace", inputs: null, acceptsEmptyInputs: true, machineProviderId: null },
  { id: "boat-sandbox", inputs: { type: "object" }, acceptsEmptyInputs: true, environmentProviderId: "project-checkout", machineProviderId: "boat-sandbox", machineInputs: { type: "object" }, machineAcceptsEmptyInputs: true },
];

type SpawnBb = Parameters<typeof createSpawner>[0];

type Metadata = Awaited<ReturnType<SpawnBb["sdk"]["threads"]["getPluginMetadata"]>>;
type SpawnArgs = Parameters<SpawnBb["sdk"]["threads"]["spawn"]>[0];
type AgentsBb = Parameters<typeof createAgents>[0]["bb"];
type IssuesBb = Parameters<typeof createIssues>[0]["bb"];
type InboxBb = Parameters<typeof createInbox>[0]["bb"];
type VerifyBb = Parameters<typeof createVerify>[0]["bb"];
type PrWatchBb = Parameters<typeof createPrWatch>[0]["bb"];
type SendArgs = Parameters<AgentsBb["sdk"]["threads"]["send"]>[0];
type Delivery = Awaited<ReturnType<InboxBb["sdk"]["threads"]["send"]>>;
type QueuedMessage = Awaited<ReturnType<InboxBb["sdk"]["threads"]["queuedMessages"]["list"]>>[number] & Awaited<ReturnType<AgentsBb["sdk"]["threads"]["queuedMessages"]["list"]>>[number];

type ThreadRef = { id: string; originPluginId: string | null };
/** A thread as bb's events carry it: the thread as it is now, which the generic thread event reads the status of. */
type ThreadNow = ThreadRef & Pick<HolderThread, "status">;
type InteractionPayload = PluginThreadEventPayloads["interaction.pending"]["interaction"]["payload"];

/** The events the plugin listens to, with the fields it reads. */
type FakeEvents = {
  "thread.created": { thread: ThreadRef };
  "thread.active": { thread: ThreadRef };
  "thread.idle": { thread: ThreadRef & { environmentId: string | null }; lastAssistantText: string | null };
  "thread.failed": { thread: ThreadRef; error: string | null };
  "thread.archived": { thread: ThreadRef };
  "thread.unarchived": { thread: ThreadRef };
  "thread.deleted": { thread: ThreadRef };
  "interaction.pending": { thread: ThreadRef; interaction: { payload: InteractionPayload } };
  "experimental_thread.events": { thread: ThreadNow };
  "message.dispatched": { entry: { id: string } };
  "message.cancelled": { entry: { id: string } };
};
type FakeEventName = keyof FakeEvents;
type Handlers = { [E in FakeEventName]: ((payload: FakeEvents[E]) => void | Promise<void>)[] };

/** The model a thread runs on and its permission mode, as bb reports them for its latest turn. */
type FakeExecution = { model: string; reasoningLevel: string; serviceTier: string; permissionMode: string };

/**
 * A thread as the fake bb keeps it: what the plugin can list, what it was spawned with, the provider
 * and model bb runs it on (null: bb has no turn of it on record), and the sequence of each of its
 * turns, oldest first.
 */
type FakeThread = HolderThread & {
  id: string;
  providerId: string;
  environmentId: string | null;
  execution: FakeExecution | null;
  environmentBranchName: string | null;
  environmentHostId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  spawnedWith: SpawnArgs;
  turns: number[];
};

/** What bb runs a spawn on when it names no provider or model that bb counts. */
export const BB_DEFAULT = { providerId: "codex", model: "gpt-default" };

/** The commit bb's git plugin reads checked out in every environment a test doesn't set another for: the one its done handoffs claim. */
export const HEAD = "0123456789abcdef0123456789abcdef01234567";

/**
 * What bb runs a spawn on, by bb's rule for a create: a requested field counts only when its
 * `executionInputSources` entry is set, or the spawn has none. An uncounted permission mode is the
 * parent's, as bb gives a child; any other uncounted field gets bb's default. why not bb's fallback
 * to a parent's provider and model: the plugin must not rely on it.
 */
function runsOn(args: SpawnArgs, parent: FakeThread | null): { providerId: string; execution: FakeExecution } {
  const { executionInputSources: sources } = args;
  const counted = <V>(field: keyof NonNullable<typeof sources>, value: V | undefined): V | null => (value !== undefined && (sources === undefined || sources[field] !== undefined) ? value : null);
  return {
    providerId: counted("providerId", args.providerId) ?? BB_DEFAULT.providerId,
    execution: {
      model: counted("model", args.model) ?? BB_DEFAULT.model,
      reasoningLevel: counted("reasoningLevel", args.reasoningLevel) ?? "medium",
      serviceTier: counted("serviceTier", args.serviceTier) ?? "default",
      permissionMode: counted("permissionMode", args.permissionMode) ?? parent?.execution?.permissionMode ?? "auto",
    },
  };
}

/**
 * How the fake bb answers a spawn. `created` delivers `thread.created` for the new thread, as bb does
 * before its spawn answer; `answer` is that answer: the thread, or lost (the call rejects).
 */
type SpawnBehaviour = { created: boolean; answer: "thread" | "lost" };

/** A provider bb can run in every environment, with its models (null: bb can't load them). */
type FakeProvider = { id: string; available: boolean; models: { model: string; isDefault: boolean; defaultReasoningEffort: string }[] | null };

/** The providers bb has unless a test changes them: Claude Code, as the composer picks it, and Codex. */
const PROVIDERS: FakeProvider[] = [
  {
    id: "claude-code",
    available: true,
    models: [
      { model: "opus", isDefault: true, defaultReasoningEffort: "high" },
      { model: "sonnet", isDefault: false, defaultReasoningEffort: "medium" },
    ],
  },
  { id: "codex", available: true, models: [{ model: "gpt-default", isDefault: true, defaultReasoningEffort: "low" }] },
];

/** How bb fails the sends to one thread (see `sends`). */
export type SendFailure = { threadId: string; error: Error; taken: boolean };

/**
 * A pull request as the fake GitHub holds it, in GitHub's words: its state, draft flag, review
 * decision, head commit, and its checks rolled up (null: none reported) with the names of the
 * failed ones.
 */
export type FakePr = {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  head: string;
  rollup: "SUCCESS" | "FAILURE" | "PENDING" | null;
  failed: string[];
};

/**
 * gh's answer to the watch's query, built as GitHub builds it: one aliased field per branch
 * variable, each with that branch's pull request, or none.
 */
function graphqlAnswer(args: string[], prs: ReadonlyMap<string, FakePr>): string {
  const branches = args.flatMap((arg) => {
    const match = /^(b\d+)=(.*)$/s.exec(arg);
    return match === null ? [] : [[match[1], match[2]] as const];
  });
  const field = (pr: FakePr | undefined) => ({
    nodes:
      pr === undefined
        ? []
        : [
            {
              number: pr.number,
              url: `https://github.com/acme/webhooks/pull/${pr.number}`,
              state: pr.state,
              isDraft: pr.isDraft,
              reviewDecision: pr.reviewDecision,
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: pr.head,
                      statusCheckRollup:
                        pr.rollup === null
                          ? null
                          : { state: pr.rollup, contexts: { nodes: [...pr.failed.map((name) => ({ __typename: "CheckRun", name, conclusion: "FAILURE" })), { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS" }] } },
                    },
                  },
                ],
              },
            },
          ],
  });
  return JSON.stringify({ data: { repository: Object.fromEntries(branches.map(([alias, branch]) => [alias, field(prs.get(branch))])) } });
}

/** Whether a stop leaves the thread idle, or still stopping, as bb's unconfirmed interrupt does. */
type StopBehaviour = "idle" | "stopping";

type Storage = Pick<PluginStorage, "database" | "migrate">;

/**
 * `storage`: the plugin's database, as bb keeps it across reloads; a test may give one an earlier
 * version of the plugin used. `turnWaitMs`: how long a tool call waits for its issue's turn (null:
 * the plugin's own bound); a test shortens it to see a call refused.
 */
export function harness(spawns: SpawnBehaviour = { created: true, answer: "thread" }, stops: StopBehaviour = "idle", storage: Storage = memoryStorage().storage, turnWaitMs: number | null = null) {
  const behaviour = { ...spawns };
  /**
   * The providers bb lists, in its order; a test may replace them. Set `holding` to keep each answer
   * of a provider's models, as read when called, until the test calls its release in `held`.
   */
  const providers: { list: FakeProvider[]; holding: boolean; held: (() => void)[] } = { list: structuredClone(PROVIDERS), holding: false, held: [] };
  /**
   * Set `failure` to make every send to its thread reject with its error: before bb takes the
   * message, or after, when `taken`, as when the connection drops while bb answers. Set `pending`
   * to hold every send until it settles, as a slow bb does. Set `unanswered` to have bb take every
   * send and never answer, as when the plugin crashes during the call.
   */
  const sends: { failure: SendFailure | null; pending: Promise<void> | null; unanswered: boolean } = { failure: null, pending: null, unanswered: false };
  /**
   * GitHub and gh as the PR watch reaches them: the project's git remote (null: none), each
   * branch's pull request, a failure every gh run rejects with instead (null: none), and every
   * run's arguments. A test sets them between ticks. Set `pending` to hold every run's answer,
   * GitHub's as the run began, until it settles, as a slow network does.
   */
  const github: { remote: string | null; prs: Map<string, FakePr>; failure: Error | null; pending: Promise<void> | null; runs: string[][] } = {
    remote: "https://github.com/acme/webhooks.git",
    prs: new Map(),
    failure: null,
    pending: null,
    runs: [],
  };
  /** The time the tick runs at; a test moves it on. */
  const clock = { now: 1_000_000 };
  /**
   * bb's git plugin as the plugin reaches it, by environment id: the branch each has checked out
   * (absent: none, as when detached; bb checks out the branch it made a new environment on), the
   * commit (absent: HEAD), how many files changed in its
   * working tree (absent: none),
   * the ones outside git, the ones whose machine it can't read, and a row a newer bb--git answers
   * instead, in a shape the plugin's contract doesn't name; and the keys of every `status` call.
   * Set `holding` to keep each answer, as read when called, until the test calls its release in `held`.
   */
  const git: {
    checkouts: Map<string, string>;
    heads: Map<string, string>;
    changedFiles: Map<string, number>;
    nonGit: Set<string>;
    offline: Set<string>;
    newer: Map<string, object>;
    calls: string[][];
    holding: boolean;
    held: (() => void)[];
  } = {
    checkouts: new Map(),
    heads: new Map(),
    changedFiles: new Map(),
    nonGit: new Set(),
    offline: new Set(),
    newer: new Map(),
    calls: [],
    holding: false,
    held: [],
  };
  /**
   * The project's repository as bb cuts new branches from it: the branches of its checkout on the
   * regional manager's machine (`local`), which every worktree's branch is, kept after its worktree
   * is removed (bb-facts P1c), and origin's (`origin`), each with its tip. A sandbox's branch is in
   * neither: only a push puts it on origin (SH4). A test commits and pushes with commit and push.
   */
  const repo: { local: Map<string, string>; origin: Map<string, string> } = { local: new Map([["main", HEAD]]), origin: new Map([["main", HEAD]]) };
  /**
   * Set `holding` to have bb answer each spawn of a new environment before it provisions it, as bb
   * does, until the test calls its provisioning in `held`: the thread has no environment meanwhile,
   * and its branch is cut from its base as the repository has it then.
   */
  const provisioning: { holding: boolean; held: (() => void)[] } = { holding: false, held: [] };
  /** The environments bb made as a worktree, and as a sandbox, by id. */
  const kinds: { worktrees: Set<string>; sandboxes: Set<string> } = { worktrees: new Set(), sandboxes: new Set() };
  /**
   * Set `failure` to make every read of a thread's turns reject with it, as when bb can't answer; set `pending` to hold every read until it settles.
   * Set `holding` to keep each answer, as read when called, until the test calls its release in `held`.
   */
  const turnEvents: { failure: Error | null; pending: Promise<void> | null; holding: boolean; held: (() => void)[] } = { failure: null, pending: null, holding: false, held: [] };
  /** Set `failure` to make every delete of a queued message reject with it, leaving the message queued, as when bb can't be reached. */
  const queueDeletes: { failure: Error | null } = { failure: null };
  /**
   * Set `failure` to make every listing of threads by id reject with it, as when bb can't answer.
   * Set `holding` to keep each answer, as read when called, until the test calls its release in `held`.
   */
  const threadLists: { failure: Error | null; holding: boolean; held: (() => void)[] } = { failure: null, holding: false, held: [] };
  /**
   * Set `pending` to hold every stop until it settles, as a slow bb does; set `failure` to make every
   * stop reject with it then. `byThread` overrides one thread's stop: an error it rejects with, or
   * "stopping", which leaves the thread stopping. Set `lost` to have every stop land and then reject
   * with it, as when bb's answer is lost on the way back.
   */
  const stopRequests: { pending: Promise<void> | null; failure: Error | null; lost: Error | null; byThread: Map<string, Error | "stopping"> } = {
    pending: null,
    failure: null,
    lost: null,
    byThread: new Map(),
  };
  /** Set `answered` to run as bb answers a thread's model lookup, as when someone acts at that moment. */
  const modelLookups: { answered: ((threadId: string) => void) | null } = { answered: null };
  let openedStore = openStore(storage);
  const memoryWrites: CoordinatorId[] = [];
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-test-")), "data.db"), openedStore, (id) => memoryWrites.push(id));
  const metadata = new Map<string, Metadata>();
  const tools = new Map<string, { parameters: z.ZodType; run(input: unknown, threadId: string): Promise<PluginAgentToolResult> }>();
  let configure: ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration) | null = null;
  const handlers: Partial<Handlers> = {};
  // why a generic function: it keeps each event's handlers typed by that event.
  const handlersOf = <E extends FakeEventName>(event: E): Handlers[E] => (handlers[event] ??= []);
  const fakeThreads = new Map<string, FakeThread>();
  const queue: (QueuedMessage & { threadId: string; text: string })[] = [];
  /** Every message that reached a thread and started its turn: sent at once, or dispatched from the queue. */
  const delivered: { threadId: string; text: string }[] = [];
  const textOfInput = (args: SendArgs): string => args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const sent: SendArgs[] = [];
  const attempted: string[] = [];
  const invalidated: string[] = [];
  const warnings: string[] = [];
  const disposers: (() => void)[] = [];
  let spawned = 0;
  let bindings = 0;
  let sequence = 0;
  let queued = 0;

  function fakeThread(threadId: string): FakeThread {
    const thread = fakeThreads.get(threadId);
    if (thread === undefined) throw new Error(`No thread ${threadId}`);
    return thread;
  }

  function environmentOf(threadId: string): string {
    const { environmentId } = fakeThread(threadId);
    if (environmentId === null) throw new Error(`bb provisioned no environment for ${threadId}`);
    return environmentId;
  }

  /** A new turn starts in the thread, as when someone sends it a message. */
  function startTurn(thread: FakeThread): void {
    thread.status = "active";
    thread.turns.push(++sequence);
  }

  async function emit<E extends FakeEventName>(event: E, payload: FakeEvents[E]): Promise<void> {
    for (const handler of handlersOf(event)) await handler(payload);
  }

  /**
   * The commit bb cuts a new environment's branch from, as it resolves the base it was given; or why
   * it can't. A worktree's named base is a local branch, or `origin/<branch>`, which bb fetches; a bare
   * name with no local branch is an invalid reference, and bb fetches no commit (bb-facts P1b, P2). A
   * sandbox clones from origin, so its base must be there in either form (SH2).
   */
  function cutFrom(environment: SpawnArgs["environment"]): { tip: string } | { error: string } {
    const named = (name: string, tip: string | undefined) => (tip === undefined ? { error: `git worktree add failed: fatal: invalid reference: ${name}` } : { tip });
    const onOrigin = (name: string) => repo.origin.get(name.replace(/^origin\//, ""));
    if (environment?.type === "host" && environment.workspace?.type === "managed-worktree" && environment.workspace.baseBranch?.kind === "named") {
      const { name } = environment.workspace.baseBranch;
      return named(name, name.startsWith("origin/") ? onOrigin(name) : repo.local.get(name));
    }
    const inputs: unknown = environment?.type === "provider" ? environment.inputs : null;
    const base = z.object({ branch: z.object({ baseBranch: z.string() }) }).safeParse(inputs);
    return base.success ? named(base.data.branch.baseBranch, onOrigin(base.data.branch.baseBranch)) : { tip: HEAD };
  }

  /**
   * bb provisions a new thread's environment: it cuts the thread's branch from its base as the
   * repository has it now, and checks it out; or, for a base it can't resolve, fails the thread, with
   * no environment and no branch, announcing that after the spawn answered (bb-facts P1b(b), P2a;
   * seen live in issue 06).
   */
  function provision(thread: FakeThread): void {
    const { id, spawnedWith } = thread;
    const cut = cutFrom(spawnedWith.environment);
    if ("error" in cut) {
      thread.status = "error";
      setTimeout(() => void emit("thread.failed", { thread: ref(id), error: `thread_provisioning_failed: ${cut.error}` }), 0);
      return;
    }
    const environmentId = `env_${id}`;
    Object.assign(thread, { environmentId, environmentBranchName: `bb/${id}` });
    git.heads.set(environmentId, cut.tip);
    git.checkouts.set(environmentId, `bb/${id}`);
    if (spawnedWith.environment?.type === "host") {
      kinds.worktrees.add(environmentId);
      repo.local.set(`bb/${id}`, cut.tip);
    } else kinds.sandboxes.add(environmentId);
  }

  const threads = {
    async spawn(args) {
      const reused = args.environment?.type === "reuse" ? args.environment.environmentId : null;
      // As bb does, a reuse of an environment it destroyed is refused before any thread exists (a local one answers so; a sandbox's "HTTP 404: Host is unavailable").
      if (reused !== null && environmentRecords.destroyed.has(reused)) throw bbHttpError(409, "environment_unavailable", "Environment unavailable");
      const id = `thr_${++spawned}`;
      metadata.set(id, args.pluginMetadata ?? {});
      const thread: FakeThread = {
        id,
        status: "active",
        hasPendingInteraction: false,
        ...runsOn(args, args.parentThreadId === undefined ? null : fakeThread(args.parentThreadId)),
        environmentId: reused,
        // As bb does, a thread in a reused environment reports the branch bb made that environment on.
        environmentBranchName: reused === null ? null : ([...fakeThreads.values()].find((thread) => thread.environmentId === reused)?.environmentBranchName ?? null),
        environmentHostId: "host_1",
        archivedAt: null,
        deletedAt: null,
        spawnedWith: args,
        turns: [],
      };
      fakeThreads.set(id, thread);
      if (reused === null && provisioning.holding) provisioning.held.push(() => provision(thread));
      else if (reused === null) provision(thread);
      if (thread.status !== "error") startTurn(thread);
      if (behaviour.created) await emit("thread.created", { thread: { id, originPluginId: PLUGIN_ID } });
      if (behaviour.answer === "lost") throw new Error("socket hang up");
      return { id };
    },
    getPluginMetadata: async ({ threadId }) => {
      const value = metadata.get(threadId);
      if (value === undefined) throw new Error(`No thread ${threadId}`);
      return value;
    },
    // As bb does, listing by id includes archived and deleted threads. why optional: bb's SDK lists without ids too; the plugin always names them.
    // As bb does, each row is a copy, its turns included: what the plugin read stays as read while the thread moves on.
    list: async ({ threadIds }: { threadIds?: readonly string[] } = {}) => {
      if (threadIds === undefined) throw new Error("The plugin lists threads by id");
      if (threadLists.failure !== null) throw threadLists.failure;
      const listed = threadIds.flatMap((id) => {
        const thread = fakeThreads.get(id);
        return thread === undefined ? [] : [{ ...thread, turns: [...thread.turns] }];
      });
      if (threadLists.holding) await new Promise<void>((release) => threadLists.held.push(release));
      return listed;
    },
    async defaultExecutionOptions({ threadId }) {
      const { execution } = fakeThread(threadId);
      modelLookups.answered?.(threadId);
      return execution;
    },
    // As bb does, a deleted or archived thread refuses a message before taking it, a
    // queue-if-active message to a busy thread is queued, and so is an auto one to a thread waiting
    // on an interaction; any other starts a turn.
    async send(args): Promise<Delivery> {
      attempted.push(args.threadId);
      await sends.pending;
      const thread = fakeThread(args.threadId);
      if (thread.deletedAt !== null) throw bbHttpError(404, "thread_not_found", "Thread not found");
      if (thread.archivedAt !== null) throw bbHttpError(409, "thread_not_writable", "Thread is archived");
      const failure = sends.failure?.threadId === args.threadId ? sends.failure : null;
      if (failure?.taken === false) throw failure.error;
      sent.push(args);
      const answer = async (delivery: Delivery): Promise<Delivery> => {
        if (failure !== null) throw failure.error;
        return sends.unanswered ? new Promise(() => {}) : delivery;
      };
      if ((args.mode === "queue-if-active" && thread.status !== "idle") || (args.mode === "auto" && thread.hasPendingInteraction)) {
        const text = textOfInput(args);
        const entry: (typeof queue)[number] = { id: `qm_${++queued}`, state: "queued", failureReason: null, senderThreadId: args.senderThreadId ?? null, content: [{ type: "text", text, mentions: [] }], threadId: args.threadId, text };
        queue.push(entry);
        return answer({ delivery: "queued", queuedMessage: { id: entry.id } });
      }
      startTurn(thread);
      delivered.push({ threadId: args.threadId, text: textOfInput(args) });
      return answer({ delivery: "sent" });
    },
    queuedMessages: {
      async list({ threadId }) {
        if (fakeThread(threadId).deletedAt !== null) throw bbHttpError(404, "thread_not_found", "Thread not found");
        return queue.filter((entry) => entry.threadId === threadId);
      },
      // As bb does, deleting a message that already left the queue fails, and a deleted one is announced.
      async delete({ queuedMessageId }) {
        if (queueDeletes.failure !== null) throw queueDeletes.failure;
        const at = queue.findIndex((entry) => entry.id === queuedMessageId);
        if (at === -1) throw new Error(`No queued message ${queuedMessageId}`);
        queue.splice(at, 1);
        await emit("message.cancelled", { entry: { id: queuedMessageId } });
        return { ok: true };
      },
    },
    // As bb does, a deleted thread's events are gone; an archived one's stay readable.
    events: {
      list: async ({ threadId }: { threadId: string }) => {
        await turnEvents.pending;
        if (turnEvents.failure !== null) throw turnEvents.failure;
        const thread = fakeThread(threadId);
        if (thread.deletedAt !== null) throw bbHttpError(404, "thread_not_found", "Thread not found");
        const latest = thread.turns.at(-1);
        if (turnEvents.holding) await new Promise<void>((release) => turnEvents.held.push(release));
        return latest === undefined ? [] : [{ seq: latest }];
      },
    },
    // As bb does, a stop that ends a running turn announces the thread idle, with the interrupted turn's last answer.
    async stop({ threadId }) {
      await stopRequests.pending;
      const own = stopRequests.byThread.get(threadId);
      if (own instanceof Error) throw own;
      if (stopRequests.failure !== null) throw stopRequests.failure;
      const thread = fakeThread(threadId);
      const leaves = own ?? stops;
      const interrupted = thread.status !== "idle" && leaves === "idle";
      thread.status = leaves;
      if (interrupted) await emit("thread.idle", { thread: { ...ref(threadId), environmentId: thread.environmentId }, lastAssistantText: "Interrupted halfway." });
      if (stopRequests.lost !== null) throw stopRequests.lost;
    },
    // As bb does, archiving the last live thread of a sandbox destroys it within seconds (SH5); a worktree stays a few minutes (SH1).
    async archive({ threadId }) {
      const thread = fakeThread(threadId);
      thread.archivedAt = Date.now();
      const { environmentId } = thread;
      if (environmentId === null) return;
      const lives = [...fakeThreads.values()].some((other) => other.environmentId === environmentId && other.archivedAt === null && other.deletedAt === null);
      if (kinds.sandboxes.has(environmentId) && !lives) environmentRecords.destroyed.add(environmentId);
    },
    output: async () => ({ output: "Done: npm test passes." }),
  } satisfies SpawnBb["sdk"]["threads"] & AgentsBb["sdk"]["threads"] & IssuesBb["sdk"]["threads"] & InboxBb["sdk"]["threads"] & TurnsBb["sdk"]["threads"] & VerifyBb["sdk"]["threads"] & PrWatchBb["sdk"]["threads"];
  const agents: ToolsBb["agents"] & Parameters<typeof registerRoles>[0]["agents"] = {
    registerTool(tool) {
      tools.set(tool.name, { parameters: tool.parameters, run: async (input, threadId) => tool.execute(tool.parameters.parse(input), { threadId, projectId: "prj_1", signal: new AbortController().signal }) });
    },
    configure(provider) {
      configure = provider;
    },
  };
  // why satisfies, and an optional provider: bb's SDK takes either call without arguments, and the plugin always names the provider.
  const providersArea = {
    list: async () => providers.list.map(({ id, available }) => ({ id, available })),
    async models({ providerId }: { providerId?: string } = {}) {
      if (providerId === undefined) throw new Error("The plugin names the provider whose models it reads");
      const models = providers.list.find((provider) => provider.id === providerId)?.models ?? null;
      if (providers.holding) await new Promise<void>((release) => providers.held.push(release));
      return models === null ? { modelLoadError: { code: "auth_required", detail: null, providerId }, models: [] } : { modelLoadError: null, models };
    },
  } satisfies CatalogBb["sdk"]["providers"];
  const projects = { get: async (_: { projectId: string }) => ({ gitRemoteUrl: github.remote }) };
  /**
   * bb's environments: the ones it has destroyed, as when their sandbox was removed (every other one
   * is ready), and the project's default branch bb records on each. Set `holding` to keep each answer, as read when called, until the test calls its release in `held`.
   */
  const environmentRecords: { destroyed: Set<string>; defaultBranch: string | null; holding: boolean; held: (() => void)[] } = { destroyed: new Set(), defaultBranch: "main", holding: false, held: [] };
  const environments = {
    listProviders: async () => ENVIRONMENT_PROVIDERS,
    async get({ environmentId }: { environmentId: string }) {
      const answer = { status: environmentRecords.destroyed.has(environmentId) ? "destroyed" : "ready", defaultBranch: environmentRecords.defaultBranch };
      if (environmentRecords.holding) await new Promise<void>((release) => environmentRecords.held.push(release));
      return answer;
    },
  };
  // As bb--git answers `status`, each key's row in its shape; the caller's schema parses it, as bb's callRpc does.
  function gitStatus(environmentId: string): object {
    const newer = git.newer.get(environmentId);
    if (newer !== undefined) return newer;
    if (git.nonGit.has(environmentId)) return { outcome: "not_applicable", reason: "non_git_environment", message: "The environment is not a git repository" };
    if (git.offline.has(environmentId)) return { outcome: "unavailable", failure: { code: "unknown", workspacePath: "/work/webhooks", message: "The environment's machine is offline" } };
    const branchName = git.checkouts.get(environmentId);
    const headSha = git.heads.get(environmentId) ?? HEAD;
    const fileCount = git.changedFiles.get(environmentId) ?? 0;
    return {
      outcome: "available",
      workspace: {
        checkout: branchName === undefined ? { kind: "detached", headSha } : { kind: "branch", branchName, headSha },
        workingTree: { fileCount, files: Array.from({ length: fileCount }, (_, i) => ({ path: `scratch-${i + 1}.txt`, status: "??", insertions: null, deletions: null })) },
      },
    };
  }
  const plugins = {
    // why any input: bb's SDK takes any JSON; git's status RPC takes the keys of the environments to read.
    async callRpc<T>({ pluginId, method, input, outputSchema }: { pluginId?: string; method: string; input?: unknown; outputSchema: z.ZodType<T> }): Promise<T> {
      if (pluginId !== "bb--git" || method !== "status") throw new Error(`No rpc ${pluginId} ${method}`);
      const { keys } = z.object({ keys: z.array(z.string()) }).parse(input);
      git.calls.push(keys);
      const answer = outputSchema.parse(Object.fromEntries(keys.map((key) => [key, gitStatus(key)])));
      if (git.holding) await new Promise<void>((release) => git.held.push(release));
      return answer;
    },
  };
  async function gh(args: string[]): Promise<string> {
    github.runs.push(args);
    if (github.failure !== null) throw github.failure;
    const answer = graphqlAnswer(args, github.prs);
    await github.pending;
    return answer;
  }
  const fakeBb = {
    pluginId: PLUGIN_ID,
    sdk: { threads, providers: providersArea, projects, plugins, environments },
    log: { warn: (message: string) => void warnings.push(message) },
    onDispose: (hook: () => void) => void disposers.push(hook),
    events: {
      on<E extends FakeEventName>(event: E, handler: (payload: FakeEvents[E]) => void | Promise<void>): void {
        handlersOf(event).push(handler);
      },
    },
    agents,
  };

  const refreshBoard = (id: CoordinatorId) => invalidated.push(`board:${id}`);

  const refreshCoordinators = () => invalidated.push("coordinators");

  /** The plugin's modules over the store and the fake bb, wired as server.ts wires them. */
  function wire() {
    const instance = pluginInstance(fakeBb);
    const { bb } = instance;
    // why shadowed: the modules act through the store bound to their instance; the tests read the store as it is.
    const store = instance.bind(openedStore);
    const onChange = (id: CoordinatorId) => {
      refreshBoard(id);
      views.changed(id);
      unblocked.changed(id);
    };
    const onRemoved = (id: CoordinatorId) => {
      threadEvents.forget(id);
      refreshCoordinators();
    };
    const spawner = createSpawner(bb, store, memory, (role) => {
      bindings++;
      if (role.kind !== "coordinator") onChange(role.coordinatorId);
    });
    const board = createBoard(bb, store, memory);
    const inbox = createInbox({ bb, store, memory, onChange });
    const views = currentViews({ bb, store });
    const unblocked = watchUnblocked({ bb, store, views, inbox });
    const turns = turnWaitMs === null ? issueTurns(instance.signal) : issueTurns(instance.signal, turnWaitMs);
    const prWatch = createPrWatch({ bb, store, inbox, gh, now: () => clock.now });
    const agents = createAgents({ bb, store, spawner, inbox, memory, turns, prs: prWatch, placementFacts: placementFactsReader(bb, store), onChange, onRemoved });
    const issues = createIssues({ bb, store, views, onChange });
    const verify = createVerify({ bb, store, spawner, inbox, turns });
    registerRoles(bb, store);
    registerCrewTools(bb, { store, inbox, memory, board, onChange: refreshBoard });
    registerIssueTools(bb, { store, issues });
    registerAgentTools(bb, { store, agents });
    registerHandoffTool(bb, { store, verify });
    registerVerdictTool(bb, { store, verify });
    const threadEvents = forwardThreadEvents(bb, { store, agents, onChange, refreshBoard });
    watchAgentThreads({ bb, store, inbox });
    watchOwnTree({ bb, store, inbox });
    return { spawner, inbox, verify, agents, prWatch, unblocked, rpc: { ...memoryHandlers(store, memory, inbox), ...boardHandlers({ store, board, inbox }) } };
  }
  let plugin = wire();

  const ref = (threadId: string): ThreadNow => ({ id: threadId, originPluginId: PLUGIN_ID, status: fakeThread(threadId).status });

  const threadNow = (threadId: string): Promise<void> => emit("experimental_thread.events", { thread: ref(threadId) });

  async function starting(threadId: string): Promise<void> {
    const thread = fakeThread(threadId);
    startTurn(thread);
    thread.status = "starting";
    await threadNow(threadId);
  }

  async function active(threadId: string): Promise<void> {
    fakeThread(threadId).status = "active";
    await emit("thread.active", { thread: ref(threadId) });
  }

  return {
    get store() {
      return openedStore;
    },
    memory,
    get spawner() {
      return plugin.spawner;
    },
    /** How bb answers the next spawns; a test may change it between them. */
    spawns: behaviour,
    /** How bb answers the next sends; a test may change it between them. */
    sends,
    /** What happens as bb answers a model lookup; a test may set it. */
    modelLookups,
    /** The providers bb lists, in its order; a test may replace them, or hold the reads of their models. */
    providers,
    /** The inbox, as the tools and the verify step write to it. */
    get inbox() {
      return plugin.inbox;
    },
    /** The app's RPC handlers, as server.ts registers them. */
    get rpc() {
      return plugin.rpc;
    },
    /** GitHub and gh as the PR watch reaches them; a test may change them between ticks. */
    github,
    /** bb's git plugin as the PR watch and the own-tree watch reach it; a test may change it between reads. */
    git,
    /** bb's environments as the plugin reads them; a test destroys one to remove its sandbox, changes the default branch, or holds the reads. */
    environments: environmentRecords,
    /** The project's repository, locally and on origin; a test deletes a local branch, as a person can. */
    repo,
    /** How bb provisions a new thread's environment; a test may hold it until after the spawn answers. */
    provisioning,
    /** The agent commits in its thread's environment: its head moves, and a worktree's branch checked out with it, as both are one ref. */
    commit(threadId: string, sha: string): void {
      const environmentId = environmentOf(threadId);
      const branch = git.checkouts.get(environmentId);
      git.heads.set(environmentId, sha);
      if (kinds.worktrees.has(environmentId) && branch !== undefined) repo.local.set(branch, sha);
    },
    /** The agent pushes the branch checked out in its thread's environment to origin, at its head; returns the branch. */
    push(threadId: string): string {
      const environmentId = environmentOf(threadId);
      const branch = git.checkouts.get(environmentId);
      if (branch === undefined) throw new Error(`${threadId} has no branch checked out to push`);
      repo.origin.set(branch, git.heads.get(environmentId) ?? HEAD);
      return branch;
    },
    /** How bb answers a read of a thread's turns; a test may hold it or make it fail. */
    turnEvents,
    /** How bb answers a delete of a queued message; a test may make it fail. */
    queueDeletes,
    /** How bb answers a listing of threads by id; a test may make it fail. */
    threadLists,
    /** How bb answers a stop; a test may hold it or make it fail. */
    stopRequests,
    /** The time the next tick runs at; a test may move it on. */
    clock,
    /** The schedule's once-a-minute pass, as server.ts runs it, at the clock's time. */
    async tick(): Promise<void> {
      const warned = (pass: string) => (error: unknown) => fakeBb.log.warn(`Could not ${pass}; the next tick tries again: ${error instanceof Error ? error.message : String(error)}`);
      await plugin.agents.reconcile().catch(warned("reconcile the agents"));
      await plugin.prWatch.tick(clock.now).catch(warned("read the issues' pull requests"));
      await plugin.verify.reconcile().catch(warned("reconcile the verifiers"));
      await plugin.unblocked.tick();
      await plugin.inbox.tick(clock.now);
      // why: the issues' turns the pass started run on, unwaited for, as on the server; this fake answers them at once unless a test holds bb.
      await settled();
    },
    /**
     * bb reloads the plugin, as after a crash: the old modules are disposed and forgotten, with
     * whatever they were awaiting, and new ones are wired over the same database and bb.
     */
    reload(): void {
      disposers.splice(0).forEach((hook) => hook());
      for (const registered of Object.values(handlers)) registered.length = 0;
      tools.clear();
      // why open it again: the reloaded plugin does, which runs the migrations it hasn't, as after an upgrade.
      openedStore = openStore(storage);
      plugin = wire();
    },
    /**
     * bb loads the plugin from this entry point, as it loads server.ts: over the SDK's fake plugin
     * host, whose bb is a whole BbPluginApi, with this fake bb's threads, providers, projects,
     * plugins and environments as its SDK; any other SDK call throws, naming itself. It runs beside
     * the harness's wiring, on a database of its own. The host's harness, to call what the entry
     * point registered and read it back.
     */
    load(entry: (bb: BbPluginApi) => void): FakePluginHarness {
      const host = createFakePluginHost({ pluginId: PLUGIN_ID, sdk: fakeBb.sdk, agentSkillIds: manifestSkillIds() });
      entry(host.bb);
      return host.harness;
    },
    /** A thread bb has, as the plugin can list it, and what it was spawned with. */
    thread: fakeThread,
    /** The environment bb provisioned for the thread; throws for one whose provisioning failed, which has none. */
    environment: environmentOf,
    /** How many threads bb has spawned. */
    spawned: () => spawned,
    /** Every message sent to a thread, in order. */
    sent: () => [...sent],
    /** The thread of every send the plugin attempted, refused ones included, in order. */
    sendAttempts: () => [...attempted],
    /** Every RPC tag invalidated, in order. */
    invalidated: () => [...invalidated],
    /** Every warning the plugin logged, in order. */
    warnings: () => [...warnings],
    /** bb announces this event, and every handler has run. */
    emit,
    /** A thread this plugin made, as bb's events name it, with its status now. */
    ref,
    /**
     * Someone sends the thread a message, and bb starts a turn as it does: the thread moves to
     * starting, which only its thread event says, then to active, which bb announces.
     */
    async startTurn(threadId: string): Promise<void> {
      await starting(threadId);
      await active(threadId);
    },
    /** The first half of startTurn: a new turn is starting, and bb sends the thread's event with that status. */
    starting,
    /** The second half of startTurn: the turn is active, and bb announces it. */
    active,
    /** bb sends the thread's event with the thread as it is now, as it does every second while the thread works. */
    threadNow,
    /** The thread's turn ends, and bb announces it with its last answer. */
    async idle(threadId: string, lastAssistantText: string | null): Promise<void> {
      const thread = fakeThread(threadId);
      thread.status = "idle";
      await emit("thread.idle", { thread: { ...ref(threadId), environmentId: thread.environmentId }, lastAssistantText });
    },
    /** The text of every message that reached the thread and started a turn, in order. */
    delivered: (threadId: string) => delivered.filter((message) => message.threadId === threadId).map((message) => message.text),
    /** The messages bb holds queued for the thread, oldest first. */
    queued: (threadId: string) => queue.filter((entry) => entry.threadId === threadId).map((entry) => entry.id),
    /** The user queues a message for the thread from bb's composer, as while it runs. */
    userQueues(threadId: string, text: string): void {
      queue.push({ id: `qm_${++queued}`, state: "queued", failureReason: null, senderThreadId: null, content: [{ type: "text", text, mentions: [] }], threadId, text });
    },
    /** bb sends a queued message and announces it; `silently`: the announcement is missed, as during a reload. */
    async dispatch(queuedMessageId: string, { silently = false } = {}): Promise<void> {
      const at = queue.findIndex((entry) => entry.id === queuedMessageId);
      const [entry] = queue.splice(at, 1);
      if (entry === undefined) throw new Error(`Nothing queued as ${queuedMessageId}`);
      startTurn(fakeThread(entry.threadId));
      delivered.push({ threadId: entry.threadId, text: entry.text });
      if (!silently) await emit("message.dispatched", { entry: { id: entry.id } });
    },
    /** bb fails to send a queued message and spends its retries, leaving it in the queue for the user. */
    exhaust(queuedMessageId: string): void {
      const entry = queue.find((message) => message.id === queuedMessageId);
      if (entry === undefined) throw new Error(`Nothing queued as ${queuedMessageId}`);
      Object.assign(entry, { state: "failed_exhausted", failureReason: "The provider exited before the turn started" });
    },
    /** The plugin is reloaded or disabled. */
    dispose: () => disposers.forEach((hook) => hook()),
    /** Which coordinators' memory a write changed, in order; each one invalidates its editor's reads. */
    memoryWrites: () => [...memoryWrites],
    /** How many times a ticket was newly bound. */
    bindings: () => bindings,
    /** The metadata a spawned thread was given. */
    metadataOf(threadId: string): Metadata {
      const value = metadata.get(threadId);
      if (value === undefined) throw new Error(`No thread ${threadId}`);
      return value;
    },
    /** bb's thread.created event, for a thread it made with these metadata. */
    async threadCreated(thread: ThreadRef, pluginMetadata: Metadata): Promise<void> {
      metadata.set(thread.id, pluginMetadata);
      await emit("thread.created", { thread });
    },
    /** What bb's configure resolution gives the thread, carrying these metadata. */
    configurationFor(threadId: string, pluginMetadata: PluginAgentConfigurationContext["pluginMetadata"]): PluginAgentConfiguration {
      if (configure === null) throw new Error("No configure callback");
      return configure(configurationContext(threadId, pluginMetadata));
    },
    /** Every tool the plugin registered, by name, with its parameters. */
    tools: () => [...tools].map(([name, { parameters }]) => ({ name, parameters })),
    /** Calls the tool as the thread's agent would. */
    async call(tool: string, input: unknown, threadId: string): Promise<PluginAgentToolResult> {
      const registered = tools.get(tool);
      if (registered === undefined) throw new Error(`No tool ${tool}`);
      return registered.run(input, threadId);
    },
  };
}

/** A harness with one coordinating thread started, verifying its agents' done handoffs unless `verify` is false; its thread and its id. */
export async function coordinating({ verify = true, spawns, stops, storage, turnWaitMs }: { verify?: boolean; spawns?: SpawnBehaviour; stops?: StopBehaviour; storage?: Storage; turnWaitMs?: number } = {}) {
  const kit = harness(spawns, stops, storage, turnWaitMs);
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), verify);
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  return { kit, threadId, coordinatorId: role.coordinatorId };
}

/**
 * An error as bb's SDK throws it for an error answer (BbHttpError in bb's packages/sdk/src/response.ts):
 * the status, and the code from the body bb's ApiError writes.
 */
export function bbHttpError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(`HTTP ${status}: ${message}`), { name: "BbHttpError", status, code, body: { code, message } });
}

/** Lets every ring started in the background finish: each one awaits only the fake bb. */
export const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The thread a tool's answer links to. */
export const threadIn = (text: string): string => /@thread:(\w+)/.exec(text)?.[1] ?? assert.fail(`no thread link in: ${text}`);

/** What the composer submits for this goal. */
export function newThreadRequest(goal: string): NewThreadRequest {
  return {
    projectId: "prj_1",
    providerId: "claude-code",
    model: "opus",
    reasoningLevel: "high",
    permissionMode: "auto",
    executionInputSources: { permissionMode: "explicit" },
    environment: { type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
    input: [{ type: "text", text: goal, mentions: [] }],
  };
}

/** A tool result's text, whichever form it took. */
export const textOf = (result: PluginAgentToolResult): string => (typeof result === "string" ? result : result.content.map((part) => (part.type === "text" ? part.text : "")).join(""));

export const isRefusal = (result: PluginAgentToolResult): boolean => typeof result !== "string" && result.isError === true;

/** The skills the plugin's manifest declares, as bb reads them: each folder in the directories its bb.skills names. */
function manifestSkillIds(): string[] {
  const root = join(import.meta.dirname, "../..");
  const manifest = z.object({ bb: z.object({ skills: z.array(z.string()) }) }).parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  return manifest.bb.skills.flatMap((dir) => readdirSync(join(root, dir)));
}

function configurationContext(threadId: string, pluginMetadata: PluginAgentConfigurationContext["pluginMetadata"]): PluginAgentConfigurationContext {
  return {
    pluginMetadata,
    thread: { id: threadId, title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: "prj_1", kind: "standard", name: "Webhooks", gitRemoteUrl: null },
    environment: { id: "env_1", name: null, path: "/work/webhooks", branchName: "main", workspaceProvisionType: null },
    host: { id: "host_1", name: "This Mac" },
    provider: { id: "claude-code", model: "opus", capabilities: { supportsNativeUserQuestion: true } },
    origin: { kind: null, pluginId: null },
  };
}

/** A build issue as most tests file it: a brief, and one done-criterion. */
export const ISSUE = { kind: "build", title: "Add retries", description: "Failed webhook deliveries are lost.", brief: "Retry failed deliveries with backoff.", doneCriteria: ["npm test passes"] };

/** The id issue_create's answer names. */
export const issueIn = (text: string): string => /Filed (i\d+)/.exec(text)?.[1] ?? assert.fail(`no issue filed: ${text}`);

/**
 * The regional manager `threadId` files an issue (ISSUE, with `fields` over it) and starts an agent
 * on it (with `start` added to agent_start's input); returns the issue's id and the agent's thread.
 */
export async function startedAgent(kit: ReturnType<typeof harness>, threadId: string, fields: object = {}, start: object = {}): Promise<{ issue: string; agentThreadId: string }> {
  const issue = issueIn(textOf(await kit.call("issue_create", { ...ISSUE, ...fields }, threadId)));
  return { issue, agentThreadId: threadIn(textOf(await kit.call("agent_start", { issue, ...start }, threadId))) };
}
