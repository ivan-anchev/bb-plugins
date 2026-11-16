// Tests only: the server's modules wired as server.ts wires them, over an in-memory database, a
// temporary memory folder and a fake bb that records what the plugin registers.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolResult, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { CrewThread } from "../model/board/crew-state.ts";
import type { CoordinatorId } from "../model/role.ts";
import { boardHandlers } from "./crew/board-rpc.ts";
import { createBoard } from "./crew/board.ts";
import { createCrews } from "./crew/crews.ts";
import type { TurnsBb } from "./crew/handoffs.ts";
import { forwardCrewThreadEvents } from "./crew/thread-events.ts";
import { createInbox } from "./inbox/inbox.ts";
import { watchCrewThreads } from "./inbox/thread-watch.ts";
import { openMemoryRoot } from "./memory/memory-files.ts";
import { memoryHandlers } from "./memory/memory-rpc.ts";
import { memoryStorage } from "./memory-storage.ts";
import { registerRoles } from "./roles.ts";
import { createSpawner } from "./spawn.ts";
import { openStore } from "./store.ts";
import { registerCoordinatorTools } from "./tools/coordinator-tools.ts";
import { registerCrewTools } from "./tools/crew-tools.ts";
import type { ToolsBb } from "./tools/tool-kit.ts";
import { registerVerdictTool } from "./verify/verdict-tool.ts";
import type { ModelsBb } from "./verify/verifier-model.ts";
import { createVerify } from "./verify/verify.ts";
import { createPrWatch } from "./watch/pr-watch.ts";

const PLUGIN_ID = "coordinator";

type SpawnBb = Parameters<typeof createSpawner>[0];
type Metadata = Awaited<ReturnType<SpawnBb["sdk"]["threads"]["getPluginMetadata"]>>;
type SpawnArgs = Parameters<SpawnBb["sdk"]["threads"]["spawn"]>[0];
type CrewsBb = Parameters<typeof createCrews>[0]["bb"];
type InboxBb = Parameters<typeof createInbox>[0]["bb"];
type VerifyBb = Parameters<typeof createVerify>[0]["bb"];
type PrWatchBb = Parameters<typeof createPrWatch>[0]["bb"];
type SendArgs = Parameters<CrewsBb["sdk"]["threads"]["send"]>[0];
type Delivery = Awaited<ReturnType<InboxBb["sdk"]["threads"]["send"]>>;
type QueuedMessage = Awaited<ReturnType<InboxBb["sdk"]["threads"]["queuedMessages"]["list"]>>[number];

type ThreadRef = { id: string; originPluginId: string | null };
type InteractionPayload = PluginThreadEventPayloads["interaction.pending"]["interaction"]["payload"];

/** The events the plugin listens to, with the fields it reads. */
type FakeEvents = {
  "thread.created": { thread: ThreadRef };
  "thread.active": { thread: ThreadRef };
  "thread.idle": { thread: ThreadRef; lastAssistantText: string | null };
  "thread.failed": { thread: ThreadRef; error: string | null };
  "thread.archived": { thread: ThreadRef };
  "thread.unarchived": { thread: ThreadRef };
  "thread.deleted": { thread: ThreadRef };
  "interaction.pending": { thread: ThreadRef; interaction: { payload: InteractionPayload } };
  "experimental_thread.events": { thread: ThreadRef };
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
type FakeThread = CrewThread & {
  id: string;
  providerId: string;
  environmentId: string;
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

export function harness(spawns: SpawnBehaviour = { created: true, answer: "thread" }, stops: StopBehaviour = "idle") {
  const behaviour = { ...spawns };
  /** The providers bb lists, in its order; a test may replace them. */
  const providers = { list: structuredClone(PROVIDERS) };
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
   * bb's git plugin as the watch reaches it: the branch each environment has checked out, by
   * environment id (absent: bb--git can't read it), and the keys of every `status` call.
   */
  const git: { checkouts: Map<string, string>; calls: string[][] } = { checkouts: new Map(), calls: [] };
  /** Set `failure` to make every read of a thread's turns reject with it, as when bb can't answer. */
  const turnEvents: { failure: Error | null } = { failure: null };
  /** Set `failure` to make every listing of threads by id reject with it, as when bb can't answer. */
  const threadLists: { failure: Error | null } = { failure: null };
  /** Set `answered` to run as bb answers a thread's model lookup, as when someone acts at that moment. */
  const modelLookups: { answered: ((threadId: string) => void) | null } = { answered: null };
  const store = openStore(memoryStorage().storage);
  const memoryWrites: CoordinatorId[] = [];
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-test-")), "data.db"), store, (id) => memoryWrites.push(id));
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

  /** A new turn starts in the thread, as when someone sends it a message. */
  function startTurn(thread: FakeThread): void {
    thread.status = "active";
    thread.turns.push(++sequence);
  }

  async function emit<E extends FakeEventName>(event: E, payload: FakeEvents[E]): Promise<void> {
    for (const handler of handlersOf(event)) await handler(payload);
  }

  const threads: SpawnBb["sdk"]["threads"] & CrewsBb["sdk"]["threads"] & InboxBb["sdk"]["threads"] & TurnsBb["sdk"]["threads"] & VerifyBb["sdk"]["threads"] & PrWatchBb["sdk"]["threads"] = {
    async spawn(args) {
      const id = `thr_${++spawned}`;
      metadata.set(id, args.pluginMetadata ?? {});
      const thread: FakeThread = {
        id,
        status: "active",
        hasPendingInteraction: false,
        ...runsOn(args, args.parentThreadId === undefined ? null : fakeThread(args.parentThreadId)),
        environmentId: args.environment?.type === "reuse" ? args.environment.environmentId : `env_${id}`,
        environmentBranchName: `bb/${id}`,
        environmentHostId: "host_1",
        archivedAt: null,
        deletedAt: null,
        spawnedWith: args,
        turns: [],
      };
      fakeThreads.set(id, thread);
      startTurn(thread);
      if (behaviour.created) await emit("thread.created", { thread: { id, originPluginId: PLUGIN_ID } });
      if (behaviour.answer === "lost") throw new Error("socket hang up");
      return { id };
    },
    getPluginMetadata: async ({ threadId }) => {
      const value = metadata.get(threadId);
      if (value === undefined) throw new Error(`No thread ${threadId}`);
      return value;
    },
    // As bb does, listing by id includes archived and deleted threads.
    list: async ({ threadIds }) => {
      if (threadLists.failure !== null) throw threadLists.failure;
      return threadIds.flatMap((id) => fakeThreads.get(id) ?? []);
    },
    async defaultExecutionOptions({ threadId }) {
      const { execution } = fakeThread(threadId);
      modelLookups.answered?.(threadId);
      return execution;
    },
    // As bb does, a deleted or archived thread refuses a message before taking it, a
    // queue-if-active message to a busy thread is queued, and any other starts a turn.
    async send(args): Promise<Delivery> {
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
      if (args.mode === "queue-if-active" && thread.status !== "idle") {
        const entry: (typeof queue)[number] = { id: `qm_${++queued}`, state: "queued", failureReason: null, threadId: args.threadId, text: textOfInput(args) };
        queue.push(entry);
        return answer({ delivery: "queued", queuedMessage: { id: entry.id } });
      }
      startTurn(thread);
      delivered.push({ threadId: args.threadId, text: textOfInput(args) });
      return answer({ delivery: "sent" });
    },
    queuedMessages: {
      list: async ({ threadId }) => queue.filter((entry) => entry.threadId === threadId),
      // As bb does, deleting a message that already left the queue fails, and a deleted one is announced.
      async delete({ queuedMessageId }) {
        const at = queue.findIndex((entry) => entry.id === queuedMessageId);
        if (at === -1) throw new Error(`No queued message ${queuedMessageId}`);
        queue.splice(at, 1);
        await emit("message.cancelled", { entry: { id: queuedMessageId } });
        return { ok: true };
      },
    },
    events: {
      list: async ({ threadId }) => {
        if (turnEvents.failure !== null) throw turnEvents.failure;
        const latest = fakeThread(threadId).turns.at(-1);
        return latest === undefined ? [] : [{ seq: latest }];
      },
    },
    async stop({ threadId }) {
      fakeThread(threadId).status = stops;
    },
    async archive({ threadId }) {
      fakeThread(threadId).archivedAt = Date.now();
    },
    output: async () => ({ output: "Done: npm test passes." }),
  };
  const agents: ToolsBb["agents"] & Parameters<typeof registerRoles>[0]["agents"] = {
    registerTool(tool) {
      tools.set(tool.name, { parameters: tool.parameters, run: async (input, threadId) => tool.execute(tool.parameters.parse(input), { threadId, projectId: "prj_1", signal: new AbortController().signal }) });
    },
    configure(provider) {
      configure = provider;
    },
  };
  const providersArea: ModelsBb["sdk"]["providers"] = {
    list: async () => providers.list.map(({ id, available }) => ({ id, available })),
    async models({ providerId }) {
      const models = providers.list.find((provider) => provider.id === providerId)?.models ?? null;
      return models === null ? { modelLoadError: { code: "auth_required", detail: null, providerId }, models: [] } : { modelLoadError: null, models };
    },
  };
  const projects = { get: async (_: { projectId: string }) => ({ gitRemoteUrl: github.remote }) };
  // As bb--git answers `status`: each key's checkout when it can read it, else unavailable; the caller's schema parses it, as bb's callRpc does.
  const plugins = {
    async callRpc<T>({ pluginId, method, input, outputSchema }: { pluginId: string; method: string; input: { keys: string[] }; outputSchema: z.ZodType<T> }): Promise<T> {
      if (pluginId !== "bb--git" || method !== "status") throw new Error(`No rpc ${pluginId} ${method}`);
      git.calls.push(input.keys);
      const status = (branchName: string | undefined) =>
        branchName === undefined ? { outcome: "unavailable", message: "The environment's machine is offline" } : { outcome: "available", workspace: { checkout: { kind: "branch", branchName, headSha: null } } };
      return outputSchema.parse(Object.fromEntries(input.keys.map((key) => [key, status(git.checkouts.get(key))])));
    },
  };
  async function gh(args: string[]): Promise<string> {
    github.runs.push(args);
    if (github.failure !== null) throw github.failure;
    const answer = graphqlAnswer(args, github.prs);
    await github.pending;
    return answer;
  }
  const bb = {
    pluginId: PLUGIN_ID,
    sdk: { threads, providers: providersArea, projects, plugins },
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

  /** The plugin's modules over the store and the fake bb, wired as server.ts wires them. */
  function wire() {
    const spawner = createSpawner(bb, store, memory, () => bindings++);
    const board = createBoard(bb, store, memory);
    const crews = createCrews({ bb, store, spawner, onChange: refreshBoard });
    const inbox = createInbox({ bb, store, onChange: refreshBoard });
    const verify = createVerify({ bb, store, spawner, inbox });
    registerRoles(bb, store);
    registerCoordinatorTools(bb, { store, inbox, memory, crews, board, onChange: refreshBoard });
    registerCrewTools(bb, { store, verify });
    registerVerdictTool(bb, { store, verify });
    forwardCrewThreadEvents(bb, store, refreshBoard);
    watchCrewThreads({ bb, store, inbox, onChange: refreshBoard });
    const prWatch = createPrWatch({ bb, store, inbox, gh });
    return { spawner, inbox, verify, prWatch, rpc: { ...memoryHandlers(store, memory, inbox), ...boardHandlers({ store, board, crews, inbox }) } };
  }
  let plugin = wire();

  const ref = (threadId: string): ThreadRef => ({ id: threadId, originPluginId: PLUGIN_ID });

  return {
    store,
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
    /** The providers bb lists, in its order; a test may replace them. */
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
    /** bb's git plugin as the PR watch reaches it; a test may change it between ticks. */
    git,
    /** How bb answers a read of a thread's turns; a test may make it fail. */
    turnEvents,
    /** How bb answers a listing of threads by id; a test may make it fail. */
    threadLists,
    /** The time the next tick runs at; a test may move it on. */
    clock,
    /** The schedule's once-a-minute pass, as server.ts runs it, at the clock's time. */
    async tick(): Promise<void> {
      await plugin.prWatch.tick(clock.now);
      await plugin.verify.reconcile();
      await plugin.inbox.tick(clock.now);
    },
    /**
     * bb reloads the plugin, as after a crash: the old modules are disposed and forgotten, with
     * whatever they were awaiting, and new ones are wired over the same database and bb.
     */
    reload(): void {
      disposers.splice(0).forEach((hook) => hook());
      for (const registered of Object.values(handlers)) registered.length = 0;
      tools.clear();
      plugin = wire();
    },
    /** A thread bb has, as the plugin can list it, and what it was spawned with. */
    thread: fakeThread,
    /** How many threads bb has spawned. */
    spawned: () => spawned,
    /** Every message sent to a thread, in order. */
    sent: () => [...sent],
    /** Every RPC tag invalidated, in order. */
    invalidated: () => [...invalidated],
    /** Every warning the plugin logged, in order. */
    warnings: () => [...warnings],
    /** bb announces this event, and every handler has run. */
    emit,
    /** A thread this plugin made, as bb's events name it. */
    ref,
    /** Someone sends the thread a message: a new turn starts. */
    startTurn: (threadId: string) => startTurn(fakeThread(threadId)),
    /** The thread's turn ends, and bb announces it with its last answer. */
    async idle(threadId: string, lastAssistantText: string | null): Promise<void> {
      fakeThread(threadId).status = "idle";
      await emit("thread.idle", { thread: ref(threadId), lastAssistantText });
    },
    /** The text of every message that reached the thread and started a turn, in order. */
    delivered: (threadId: string) => delivered.filter((message) => message.threadId === threadId).map((message) => message.text),
    /** The messages bb holds queued for the thread, oldest first. */
    queued: (threadId: string) => queue.filter((entry) => entry.threadId === threadId).map((entry) => entry.id),
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

/** A harness with one coordinating thread started, verifying its crews' done handoffs unless `verify` is false; its thread and its id. */
export async function coordinating({ verify = true, spawns, stops }: { verify?: boolean; spawns?: SpawnBehaviour; stops?: StopBehaviour } = {}) {
  const kit = harness(spawns, stops);
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
