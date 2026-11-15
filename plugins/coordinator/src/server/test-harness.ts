// Tests only: the server's modules wired as server.ts wires them, over an in-memory database, a
// temporary memory folder and a fake bb that records what the plugin registers.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolResult, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import type { CrewThread } from "../model/crew-state.ts";
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

const PLUGIN_ID = "coordinator";

type SpawnBb = Parameters<typeof createSpawner>[0];
type Metadata = Awaited<ReturnType<SpawnBb["sdk"]["threads"]["getPluginMetadata"]>>;
type SpawnArgs = Parameters<SpawnBb["sdk"]["threads"]["spawn"]>[0];
type CrewsBb = Parameters<typeof createCrews>[0]["bb"];
type InboxBb = Parameters<typeof createInbox>[0]["bb"];
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

/** Whether a stop leaves the thread idle, or still stopping, as bb's unconfirmed interrupt does. */
type StopBehaviour = "idle" | "stopping";

export function harness(spawns: SpawnBehaviour = { created: true, answer: "thread" }, stops: StopBehaviour = "idle") {
  const behaviour = { ...spawns };
  /** Set `failure` to make every send throw it, as bb does when it can't take the message. */
  const sends: { failure: string | null } = { failure: null };
  const store = openStore(memoryStorage().storage);
  const memoryWrites: CoordinatorId[] = [];
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-test-")), "data.db"), store, (id) => memoryWrites.push(id));
  const metadata = new Map<string, Metadata>();
  const tools = new Map<string, (input: unknown, threadId: string) => Promise<PluginAgentToolResult>>();
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

  const threads: SpawnBb["sdk"]["threads"] & CrewsBb["sdk"]["threads"] & InboxBb["sdk"]["threads"] & TurnsBb["sdk"]["threads"] = {
    async spawn(args) {
      const id = `thr_${++spawned}`;
      metadata.set(id, args.pluginMetadata ?? {});
      const thread: FakeThread = { id, status: "active", hasPendingInteraction: false, ...runsOn(args, args.parentThreadId === undefined ? null : fakeThread(args.parentThreadId)), environmentBranchName: `bb/${id}`, environmentHostId: "host_1", archivedAt: null, deletedAt: null, spawnedWith: args, turns: [] };
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
    list: async ({ threadIds }) => threadIds.flatMap((id) => fakeThreads.get(id) ?? []),
    defaultExecutionOptions: async ({ threadId }) => fakeThread(threadId).execution,
    // As bb does, a queue-if-active message to a busy thread is queued; any other starts a turn.
    async send(args): Promise<Delivery> {
      const thread = fakeThread(args.threadId);
      if (sends.failure !== null) throw new Error(sends.failure);
      sent.push(args);
      if (args.mode === "queue-if-active" && thread.status !== "idle") {
        const entry: (typeof queue)[number] = { id: `qm_${++queued}`, state: "queued", failureReason: null, threadId: args.threadId, text: textOfInput(args) };
        queue.push(entry);
        return { delivery: "queued", queuedMessage: { id: entry.id } };
      }
      startTurn(thread);
      delivered.push({ threadId: args.threadId, text: textOfInput(args) });
      return { delivery: "sent" };
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
      tools.set(tool.name, async (input, threadId) => tool.execute(tool.parameters.parse(input), { threadId, projectId: "prj_1", signal: new AbortController().signal }));
    },
    configure(provider) {
      configure = provider;
    },
  };
  const bb = {
    pluginId: PLUGIN_ID,
    sdk: { threads },
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
  const spawner = createSpawner(bb, store, memory, () => bindings++);
  const board = createBoard(bb, store, memory);
  const crews = createCrews({ bb, store, spawner, onChange: refreshBoard });
  const inbox = createInbox({ bb, store, onChange: refreshBoard });
  registerRoles(bb, store);
  registerCoordinatorTools(bb, { store, inbox, memory, crews, board });
  registerCrewTools(bb, { store, inbox });
  forwardCrewThreadEvents(bb, store, refreshBoard);
  watchCrewThreads({ bb, store, inbox, onChange: refreshBoard });

  const ref = (threadId: string): ThreadRef => ({ id: threadId, originPluginId: PLUGIN_ID });

  return {
    store,
    memory,
    spawner,
    /** How bb answers the next spawns; a test may change it between them. */
    spawns: behaviour,
    /** How bb answers the next sends; a test may change it between them. */
    sends,
    /** The app's RPC handlers, as server.ts registers them. */
    rpc: { ...memoryHandlers(store, memory, inbox), ...boardHandlers({ store, board, crews }) },
    /** The schedule's once-a-minute pass. */
    tick: () => inbox.tick(),
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
    /** Calls the tool as the thread's agent would. */
    async call(tool: string, input: unknown, threadId: string): Promise<PluginAgentToolResult> {
      const run = tools.get(tool);
      if (run === undefined) throw new Error(`No tool ${tool}`);
      return run(input, threadId);
    },
  };
}

/** A harness with one coordinating thread started, its thread and its id. */
export async function coordinating(...args: Parameters<typeof harness>) {
  const kit = harness(...args);
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  return { kit, threadId, coordinatorId: role.coordinatorId };
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
