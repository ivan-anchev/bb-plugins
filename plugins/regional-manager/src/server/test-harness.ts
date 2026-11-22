import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolResult, PluginStorage, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { createFakePluginHost, type FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import type { EnvironmentProvider } from "../model/agent.ts";
import type { HolderThread } from "../model/issue/status.ts";
import type { ComposerRequest } from "../contract.ts";
import { DEFAULT_AVATAR, type Profile } from "../model/profile.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../model/role.ts";
import { registerAgentTools } from "./agents/agent-tools.ts";
import { createAgents } from "./agents/agents.ts";
import { defaultBranchReader, placementFactsReader } from "./agents/environments.ts";
import { forwardThreadEvents } from "./agents/events/thread-events.ts";
import type { TurnsBb } from "./agents/threads.ts";
import { boardHandlers } from "./board/board-rpc.ts";
import { createBoard } from "./board/board.ts";
import type { CatalogBb } from "./execution/catalog.ts";
import { createInbox } from "./inbox/inbox.ts";
import { PLACEHOLDER, upgradeFrom030 } from "./manager/held-managers.ts";
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
import { managerHandlers } from "./manager/manager-rpc.ts";
import { memoryStorage } from "./memory-storage.ts";
import { verifyOff } from "./store/test-store.ts";
import { registerRoles } from "./roles.ts";
import { createSpawner } from "./spawn.ts";
import { openStore } from "./store/store.ts";
import { registerCrewTools } from "./tools/crew-tools.ts";
import { registerHandoffTool } from "./tools/handoff-tool.ts";
import type { ToolsBb } from "./tools/tool-kit.ts";
import { createFinalChecks } from "./verify/final-check/final-checks.ts";
import { registerVerdictTool } from "./verify/verdict-tool.ts";
import { createVerify } from "./verify/verify.ts";
import { createPrWatch } from "./watch/pr-watch.ts";

const PLUGIN_ID = "regional-manager";

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
type ManagerBb = Parameters<typeof managerHandlers>[0]["bb"];
type HeldBb = Parameters<typeof upgradeFrom030>[0];
type SendArgs = Parameters<AgentsBb["sdk"]["threads"]["send"]>[0];
type Delivery = Awaited<ReturnType<InboxBb["sdk"]["threads"]["send"]>>;
type QueuedMessage = Awaited<ReturnType<InboxBb["sdk"]["threads"]["queuedMessages"]["list"]>>[number] &
  Awaited<ReturnType<AgentsBb["sdk"]["threads"]["queuedMessages"]["list"]>>[number] &
  Awaited<ReturnType<HeldBb["sdk"]["threads"]["queuedMessages"]["list"]>>[number];

type ThreadRef = { id: string; originPluginId: string | null };
type ThreadNow = ThreadRef & Pick<HolderThread, "status">;
type InteractionPayload = PluginThreadEventPayloads["interaction.pending"]["interaction"]["payload"];

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

type FakeAsk = { id: string; status: "pending" | "resolved" | "cancelled"; payload: InteractionPayload };

type AskSettled = { how: "deny"; freeText?: never } | { how: "answer"; freeText: string } | { how: "decline" | "cancel"; freeText?: never };

type FakeExecution = { model: string; reasoningLevel: string; serviceTier: string; permissionMode: string };

type FakeThread = HolderThread & {
  id: string;
  providerId: string;
  environmentId: string | null;
  execution: FakeExecution | null;
  environmentBranchName: string | null;
  environmentHostId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  title: string | null;
  spawnedWith: SpawnArgs;
  turns: number[];
  background: number;
  createdAt: number;
  activityAt: number;
  asks: FakeAsk[];
};

/** What bb runs a spawn on when it names no provider or model that bb counts. */
export const BB_DEFAULT = { providerId: "codex", model: "gpt-default" };

/** The commit bb's git plugin reads checked out in every environment a test doesn't set another for: the one its done handoffs claim. */
export const HEAD = "0123456789abcdef0123456789abcdef01234567";

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
 * before its spawn answer; `answer` is that answer: the thread, lost (the thread exists, and the call
 * rejects), or refused (the call rejects before any thread exists).
 */
type SpawnBehaviour = { created: boolean; answer: "thread" | "lost" | "refused" };

type FakeProvider = { id: string; available: boolean; models: { model: string; isDefault: boolean; defaultReasoningEffort: string }[] | null };

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
  const providers: { list: FakeProvider[]; holding: boolean; held: (() => void)[] } = { list: structuredClone(PROVIDERS), holding: false, held: [] };
  const sends: { failure: SendFailure | null; pending: Promise<void> | null; unanswered: boolean } = { failure: null, pending: null, unanswered: false };
  const github: { remote: string | null; prs: Map<string, FakePr>; failure: Error | null; pending: Promise<void> | null; runs: string[][] } = {
    remote: "https://github.com/acme/webhooks.git",
    prs: new Map(),
    failure: null,
    pending: null,
    runs: [],
  };
  const clock = { now: 1_000_000 };
  const askAnswers: { answered: ({ threadId: string; interactionId: string } & AskSettled)[]; refusal: Error | null } = { answered: [], refusal: null };
  let asked = 0;
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
  const repo: { local: Map<string, string>; origin: Map<string, string> } = { local: new Map([["main", HEAD]]), origin: new Map([["main", HEAD]]) };
  const provisioning: { holding: boolean; held: (() => void)[] } = { holding: false, held: [] };
  const kinds: { worktrees: Set<string>; sandboxes: Set<string> } = { worktrees: new Set(), sandboxes: new Set() };
  const turnEvents: { failure: Error | null; pending: Promise<void> | null; holding: boolean; held: (() => void)[] } = { failure: null, pending: null, holding: false, held: [] };
  const queueDeletes: { failure: Error | null; lost: Error | null; deleted: (() => void) | null } = { failure: null, lost: null, deleted: null };
  const queueReads: { failure: Error | null; read: ((threadId: string) => Promise<void>) | null } = { failure: null, read: null };
  const threadLists: { failure: Error | null; holding: boolean; held: (() => void)[] } = { failure: null, holding: false, held: [] };
  const stopRequests: { pending: Promise<void> | null; failure: Error | null; lost: Error | null; byThread: Map<string, Error | "stopping"> } = {
    pending: null,
    failure: null,
    lost: null,
    byThread: new Map(),
  };
  const threadUpdates: { asked: (string | null)[]; holding: boolean; held: (() => void)[] } = { asked: [], holding: false, held: [] };
  const modelLookups: { answered: ((threadId: string) => void) | null } = { answered: null };
  let openedStore = openStore(storage);
  const memoryWrites: CoordinatorId[] = [];
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-test-")), "data.db"), openedStore, (id) => memoryWrites.push(id));
  const metadata = new Map<string, Metadata>();
  const tools = new Map<string, { parameters: z.ZodType; instructions: string | null; run(input: unknown, threadId: string): Promise<PluginAgentToolResult> }>();
  let configure: ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration) | null = null;
  const handlers: Partial<Handlers> = {};
  const handlersOf = <E extends FakeEventName>(event: E): Handlers[E] => (handlers[event] ??= []);
  const fakeThreads = new Map<string, FakeThread>();
  const queue: (QueuedMessage & { threadId: string; text: string })[] = [];
  const turnRequests = new Map<string, { initiator: string; senderThreadId: null; originPluginId?: string; input: { type: "text"; text: string }[] }[]>();
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

  function startTurn(thread: FakeThread): void {
    thread.status = "active";
    thread.activityAt = clock.now;
    thread.turns.push(++sequence);
  }

  function settleAsk(threadId: string, interactionId: string, settled: AskSettled): FakeAsk {
    const thread = fakeThread(threadId);
    const ask = thread.asks.find(({ id }) => id === interactionId);
    if (ask?.status !== "pending") throw bbHttpError(409, "interaction_not_pending", "Interaction is not pending");
    const { kind } = ask.payload;
    const takes = kind === "approval" ? "deny" : kind === "user_question" ? "answer" : kind === "plugin" ? "cancel" : "decline";
    if (settled.how !== takes) throw bbHttpError(400, "invalid_request", settled.how === "cancel" ? "Plugin interaction expected" : `A ${ask.payload.kind} interaction takes no ${settled.how}`);
    if (askAnswers.refusal !== null) throw askAnswers.refusal;
    askAnswers.answered.push({ threadId, interactionId, ...settled });
    ask.status = settled.how === "cancel" ? "cancelled" : "resolved";
    thread.hasPendingInteraction = thread.asks.some(({ status }) => status === "pending");
    thread.activityAt = clock.now;
    return ask;
  }

  async function emit<E extends FakeEventName>(event: E, payload: FakeEvents[E]): Promise<void> {
    for (const handler of handlersOf(event)) await handler(payload);
  }

  function cutFrom(environment: SpawnArgs["environment"]): { tip: string } | { error: string } {
    const named = (name: string, tip: string | undefined) => (tip === undefined ? { error: `git worktree add failed: fatal: invalid reference: ${name}` } : { tip });
    const onOrigin = (name: string) => repo.origin.get(name.replace(/^origin\//, ""));
    if (environment?.type === "host" && environment.workspace?.type === "managed-worktree" && environment.workspace.baseBranch?.kind === "named") {
      const { name } = environment.workspace.baseBranch;
      return named(name, name.startsWith("origin/") ? onOrigin(name) : repo.local.get(name));
    }
    if (environment?.type === "host" && environment.workspace?.type === "managed-worktree") {
      const branch = environmentRecords.defaultBranch ?? "main";
      return named(`origin/${branch}`, onOrigin(branch));
    }
    const inputs: unknown = environment?.type === "provider" ? environment.inputs : null;
    const base = z.object({ branch: z.object({ baseBranch: z.string() }) }).safeParse(inputs);
    return base.success ? named(base.data.branch.baseBranch, onOrigin(base.data.branch.baseBranch)) : { tip: HEAD };
  }

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
      if (reused !== null && environmentRecords.destroyed.has(reused)) throw bbHttpError(409, "environment_unavailable", "Environment unavailable");
      if (behaviour.answer === "refused") throw bbHttpError(400, "invalid_request", "Invalid environment");
      const id = `thr_${++spawned}`;
      metadata.set(id, args.pluginMetadata ?? {});
      const thread: FakeThread = {
        id,
        status: "active",
        hasPendingInteraction: false,
        ...runsOn(args, args.parentThreadId === undefined ? null : fakeThread(args.parentThreadId)),
        environmentId: reused,
        environmentBranchName: reused === null ? null : ([...fakeThreads.values()].find((thread) => thread.environmentId === reused)?.environmentBranchName ?? null),
        environmentHostId: "host_1",
        archivedAt: null,
        deletedAt: null,
        title: args.title ?? null,
        spawnedWith: args,
        turns: [],
        background: 0,
        createdAt: clock.now,
        activityAt: clock.now,
        asks: [],
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
    list: async ({ threadIds, originPluginId, hasParent, archived }: { threadIds?: readonly string[]; originPluginId?: string; hasParent?: boolean; archived?: boolean } = {}) => {
      if (threadLists.failure !== null) throw threadLists.failure;
      if (threadIds === undefined) {
        if (originPluginId !== PLUGIN_ID || hasParent !== false) throw new Error("The plugin lists threads by id, or its own top-level ones");
        const listed = [...fakeThreads.values()].filter((thread) => thread.spawnedWith.parentThreadId === undefined && thread.deletedAt === null && (archived === undefined || (thread.archivedAt !== null) === archived));
        return listed.map((thread) => ({ ...thread, turns: [...thread.turns] }));
      }
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
        const entry: (typeof queue)[number] = { id: `qm_${++queued}`, state: "queued", failureReason: null, initiator: "system", senderThreadId: args.senderThreadId ?? null, originPluginId: PLUGIN_ID, content: [{ type: "text", text, mentions: [] }], threadId: args.threadId, text };
        queue.push(entry);
        return answer({ delivery: "queued", queuedMessage: { id: entry.id } });
      }
      startTurn(thread);
      delivered.push({ threadId: args.threadId, text: textOfInput(args) });
      return answer({ delivery: "sent" });
    },
    queuedMessages: {
      async list({ threadId }) {
        if (queueReads.failure !== null) throw queueReads.failure;
        if (fakeThread(threadId).deletedAt !== null) throw bbHttpError(404, "thread_not_found", "Thread not found");
        const queued = queue.filter((entry) => entry.threadId === threadId);
        if (queueReads.read !== null) await queueReads.read(threadId);
        return queued;
      },
      async delete({ queuedMessageId }) {
        if (queueDeletes.failure !== null) throw queueDeletes.failure;
        const at = queue.findIndex((entry) => entry.id === queuedMessageId);
        if (at === -1) throw new Error(`No queued message ${queuedMessageId}`);
        queue.splice(at, 1);
        queueDeletes.deleted?.();
        await emit("message.cancelled", { entry: { id: queuedMessageId } });
        if (queueDeletes.lost !== null) throw queueDeletes.lost;
        return { ok: true };
      },
    },
    events: {
      list: async ({ threadId, types }: { threadId: string; types?: readonly string[] }) => {
        await turnEvents.pending;
        if (turnEvents.failure !== null) throw turnEvents.failure;
        const thread = fakeThread(threadId);
        if (thread.deletedAt !== null) throw bbHttpError(404, "thread_not_found", "Thread not found");
        if (types?.[0] === "client/turn/requested") return (turnRequests.get(threadId) ?? []).map((data, at) => ({ seq: at + 1, data, createdAt: thread.activityAt }));
        if (types === undefined) return [{ seq: thread.turns.at(-1) ?? 0, data: null, createdAt: thread.activityAt }];
        const latest = thread.turns.at(-1);
        if (turnEvents.holding) await new Promise<void>((release) => turnEvents.held.push(release));
        return latest === undefined ? [] : [{ seq: latest, data: null, createdAt: thread.activityAt }];
      },
    },
    interactions: {
      list: async ({ threadId }: { threadId: string }) => fakeThread(threadId).asks.map((ask) => ({ ...ask })),
      async resolve({ threadId, interactionId, resolution }: { threadId: string; interactionId: string; resolution: { decision: string } | { kind: string; answers?: Record<string, { selected: string[]; freeText?: string }> } }) {
        if ("decision" in resolution) {
          if (resolution.decision !== "deny") throw new Error("The plugin only ever declines an ask");
          return settleAsk(threadId, interactionId, { how: "deny" });
        }
        if (resolution.kind !== "user_answer" || resolution.answers === undefined) throw new Error("The plugin only ever declines an ask");
        const ask = fakeThread(threadId).asks.find(({ id }) => id === interactionId);
        const questions = ask?.payload.kind === "user_question" ? ask.payload.questions.map(({ id }) => id) : [];
        const answers = Object.entries(resolution.answers);
        if (answers.length !== questions.length || answers.some(([id, { selected, freeText }]) => !questions.includes(id) || selected.length > 0 || freeText === undefined)) throw new Error("The plugin answers each question with free text only");
        return settleAsk(threadId, interactionId, { how: "answer", freeText: answers.map(([, { freeText }]) => freeText ?? "").join("\n") });
      },
      async respond({ threadId, interactionId, value }: { threadId: string; interactionId: string; value: unknown }) {
        if (JSON.stringify(value) !== JSON.stringify({ action: "decline" })) throw new Error("The plugin only ever declines a provider's request");
        return settleAsk(threadId, interactionId, { how: "decline" });
      },
      cancel: async ({ threadId, interactionId }: { threadId: string; interactionId: string }) => settleAsk(threadId, interactionId, { how: "cancel" }),
    },
    async stop({ threadId }) {
      await stopRequests.pending;
      const own = stopRequests.byThread.get(threadId);
      if (own instanceof Error) throw own;
      if (stopRequests.failure !== null) throw stopRequests.failure;
      const thread = fakeThread(threadId);
      const leaves = own ?? stops;
      const interrupted = thread.status !== "idle" && leaves === "idle";
      thread.status = leaves;
      thread.background = 0;
      if (interrupted) await emit("thread.idle", { thread: { ...ref(threadId), environmentId: thread.environmentId }, lastAssistantText: "Interrupted halfway." });
      if (stopRequests.lost !== null) throw stopRequests.lost;
    },
    async archive({ threadId }) {
      const thread = fakeThread(threadId);
      thread.archivedAt = Date.now();
      const { environmentId } = thread;
      if (environmentId === null) return;
      const lives = [...fakeThreads.values()].some((other) => other.environmentId === environmentId && other.archivedAt === null && other.deletedAt === null);
      if (kinds.sandboxes.has(environmentId) && !lives) environmentRecords.destroyed.add(environmentId);
    },
    output: async () => ({ output: "Done: npm test passes." }),
    async get({ threadId }: { threadId: string }) {
      const { title, status } = fakeThread(threadId);
      return { title, status };
    },
    async update({ threadId, title }: { threadId: string; title?: string | null }) {
      threadUpdates.asked.push(title ?? null);
      if (threadUpdates.holding) await new Promise<void>((release) => threadUpdates.held.push(release));
      const thread = fakeThread(threadId);
      if (thread.deletedAt !== null) throw bbHttpError(404, "thread_not_found", "Thread not found");
      if (title !== undefined) thread.title = title;
    },
  } satisfies SpawnBb["sdk"]["threads"] & ManagerBb["sdk"]["threads"] & HeldBb["sdk"]["threads"] & AgentsBb["sdk"]["threads"] & IssuesBb["sdk"]["threads"] & InboxBb["sdk"]["threads"] & TurnsBb["sdk"]["threads"] & VerifyBb["sdk"]["threads"] & PrWatchBb["sdk"]["threads"];
  const agents: ToolsBb["agents"] & Parameters<typeof registerRoles>[0]["agents"] = {
    registerTool(tool) {
      tools.set(tool.name, { parameters: tool.parameters, instructions: tool.instructions ?? null, run: async (input, threadId) => tool.execute(tool.parameters.parse(input), { threadId, projectId: "prj_1", signal: new AbortController().signal }) });
    },
    configure(provider) {
      configure = provider;
    },
  };
  const providersArea = {
    list: async () => providers.list.map(({ id, available }) => ({ id, available })),
    async models({ providerId }: { providerId?: string } = {}) {
      if (providerId === undefined) throw new Error("The plugin names the provider whose models it reads");
      const models = providers.list.find((provider) => provider.id === providerId)?.models ?? null;
      if (providers.holding) await new Promise<void>((release) => providers.held.push(release));
      return models === null ? { modelLoadError: { code: "auth_required", detail: null, providerId }, models: [] } : { modelLoadError: null, models };
    },
  } satisfies CatalogBb["sdk"]["providers"];
  const projects = { get: async (_: { projectId: string }) => ({ name: PROJECT_NAME, gitRemoteUrl: github.remote }) };
  const environmentRecords: { destroyed: Set<string>; defaultBranch: string | null; holding: boolean; held: (() => void)[] } = { destroyed: new Set(), defaultBranch: "main", holding: false, held: [] };
  const environments = {
    listProviders: async () => ENVIRONMENT_PROVIDERS,
    async get({ environmentId }: { environmentId: string }) {
      const answer = { status: environmentRecords.destroyed.has(environmentId) ? "destroyed" : "ready", defaultBranch: environmentRecords.defaultBranch };
      if (environmentRecords.holding) await new Promise<void>((release) => environmentRecords.held.push(release));
      return answer;
    },
  };
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

  function wire() {
    const instance = pluginInstance(fakeBb);
    const { bb } = instance;
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
    const board = createBoard(bb, store);
    const inbox = createInbox({ bb, store, memory, onChange });
    const views = currentViews({ bb, store });
    const unblocked = watchUnblocked({ bb, store, views, inbox });
    const turns = turnWaitMs === null ? issueTurns(instance.signal) : issueTurns(instance.signal, turnWaitMs);
    const prWatch = createPrWatch({ bb, store, inbox, gh, now: () => clock.now });
    const agents = createAgents({ bb, store, spawner, inbox, memory, turns, prs: prWatch, placementFacts: placementFactsReader(bb, store), onChange, onRemoved });
    const issues = createIssues({ bb, store, views, onChange });
    const verify = createVerify({ bb, store, spawner, inbox, turns, now: () => clock.now });
    const finalChecks = createFinalChecks({ bb, store, views, turns, verify, defaultBranch: defaultBranchReader(bb, store), now: () => clock.now });
    registerRoles(bb, store);
    registerCrewTools(bb, { store, inbox, memory, board, onChange: refreshBoard });
    registerIssueTools(bb, { store, issues });
    registerAgentTools(bb, { store, agents });
    registerHandoffTool(bb, { store, verify });
    registerVerdictTool(bb, { store, verify });
    const threadEvents = forwardThreadEvents(bb, { store, agents, verify, onChange, refreshBoard });
    watchAgentThreads({ bb, store, inbox });
    watchOwnTree({ bb, store, inbox });
    return { spawner, inbox, verify, agents, prWatch, finalChecks, unblocked, rpc: { ...memoryHandlers(store, memory, inbox), ...boardHandlers({ store, board, inbox }), ...managerHandlers({ bb, store, spawner, onChange: refreshCoordinators }) }, upgrade030: upgradeFrom030(bb, { store, memory, onChange: refreshCoordinators }) };
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
    spawns: behaviour,
    sends,
    modelLookups,
    providers,
    get inbox() {
      return plugin.inbox;
    },
    get rpc() {
      return plugin.rpc;
    },
    async createManager(name: string): Promise<CoordinatorId> {
      return coordinatorIdSchema.parse((await plugin.rpc.createCoordinator({ profile: profileNamed(name) })).coordinatorId);
    },
    async startManager(name: string, { goal = name, verify = true, request = newThreadRequest(goal) }: { goal?: string; verify?: boolean; request?: ComposerRequest } = {}): Promise<{ coordinatorId: CoordinatorId; threadId: string }> {
      const coordinatorId = await this.createManager(name);
      if (!verify) verifyOff(storage, coordinatorId);
      const { threadId } = await plugin.rpc.startCoordinator({ coordinatorId, request });
      return { coordinatorId, threadId };
    },
    upgrade030: () => plugin.upgrade030(),
    github,
    git,
    environments: environmentRecords,
    repo,
    provisioning,
    commit(threadId: string, sha: string): void {
      const environmentId = environmentOf(threadId);
      const branch = git.checkouts.get(environmentId);
      git.heads.set(environmentId, sha);
      if (kinds.worktrees.has(environmentId) && branch !== undefined) repo.local.set(branch, sha);
    },
    push(threadId: string): string {
      const environmentId = environmentOf(threadId);
      const branch = git.checkouts.get(environmentId);
      if (branch === undefined) throw new Error(`${threadId} has no branch checked out to push`);
      repo.origin.set(branch, git.heads.get(environmentId) ?? HEAD);
      return branch;
    },
    turnEvents,
    queueDeletes,
    queueReads,
    threadLists,
    stopRequests,
    threadUpdates,
    clock,
    askAnswers,
    async ask(threadId: string, payload: InteractionPayload): Promise<void> {
      const thread = fakeThread(threadId);
      thread.asks.push({ id: `pint_${++asked}`, status: "pending", payload });
      thread.hasPendingInteraction = true;
      thread.activityAt = clock.now;
      await emit("interaction.pending", { thread: ref(threadId), interaction: { payload } });
    },
    async tick(): Promise<void> {
      const warned = (pass: string) => (error: unknown) => fakeBb.log.warn(`Could not ${pass}; the next tick tries again: ${error instanceof Error ? error.message : String(error)}`);
      await plugin.agents.reconcile().catch(warned("reconcile the agents"));
      await plugin.prWatch.tick(clock.now).catch(warned("read the issues' pull requests"));
      await plugin.finalChecks.tick().catch(warned("read which final checks are due"));
      await plugin.verify.reconcile().catch(warned("reconcile the verifiers"));
      await plugin.unblocked.tick();
      await plugin.inbox.tick(clock.now);
      await settled();
    },
    reload(): void {
      disposers.splice(0).forEach((hook) => hook());
      for (const registered of Object.values(handlers)) registered.length = 0;
      tools.clear();
      openedStore = openStore(storage);
      plugin = wire();
    },
    load(entry: (bb: BbPluginApi) => void): FakePluginHarness {
      const host = createFakePluginHost({ pluginId: PLUGIN_ID, sdk: fakeBb.sdk, agentSkillIds: manifestSkillIds() });
      entry(host.bb);
      return host.harness;
    },
    thread: fakeThread,
    environment: environmentOf,
    spawned: () => spawned,
    sent: () => [...sent],
    sendAttempts: () => [...attempted],
    invalidated: () => [...invalidated],
    warnings: () => [...warnings],
    emit,
    ref,
    async startTurn(threadId: string): Promise<void> {
      await starting(threadId);
      await active(threadId);
    },
    starting,
    active,
    threadNow,
    async idle(threadId: string, lastAssistantText: string | null): Promise<void> {
      const thread = fakeThread(threadId);
      thread.status = "idle";
      await emit("thread.idle", { thread: { ...ref(threadId), environmentId: thread.environmentId }, lastAssistantText });
      await settled();
    },
    leavesBackground(threadId: string): void {
      fakeThread(threadId).background += 1;
    },
    async backgroundFinishes(threadId: string): Promise<void> {
      const thread = fakeThread(threadId);
      if (thread.background === 0) return;
      thread.background = 0;
      await starting(threadId);
      await active(threadId);
    },
    delivered: (threadId: string) => delivered.filter((message) => message.threadId === threadId).map((message) => message.text),
    queued: (threadId: string) => queue.filter((entry) => entry.threadId === threadId).map((entry) => entry.id),
    heldPlaceholder(threadId: string): void {
      const text = PLACEHOLDER;
      queue.push({ id: `qm_${++queued}`, state: "waiting", failureReason: null, initiator: "user", senderThreadId: null, originPluginId: PLUGIN_ID, content: [{ type: "text", text, mentions: [] }], threadId, text });
    },
    userQueues(threadId: string, text: string): void {
      queue.push({ id: `qm_${++queued}`, state: "queued", failureReason: null, initiator: "user", senderThreadId: null, originPluginId: null, content: [{ type: "text", text, mentions: [] }], threadId, text });
    },
    turnRequested(threadId: string, text: string, by: "user" | "plugin" = "user"): void {
      const request = { initiator: "user", senderThreadId: null, ...(by === "plugin" ? { originPluginId: PLUGIN_ID } : {}), input: [{ type: "text" as const, text }] };
      turnRequests.set(threadId, [...(turnRequests.get(threadId) ?? []), request]);
    },
    async dispatch(queuedMessageId: string, { silently = false } = {}): Promise<void> {
      const at = queue.findIndex((entry) => entry.id === queuedMessageId);
      const [entry] = queue.splice(at, 1);
      if (entry === undefined) throw new Error(`Nothing queued as ${queuedMessageId}`);
      startTurn(fakeThread(entry.threadId));
      delivered.push({ threadId: entry.threadId, text: entry.text });
      if (!silently) await emit("message.dispatched", { entry: { id: entry.id } });
    },
    exhaust(queuedMessageId: string): void {
      const entry = queue.find((message) => message.id === queuedMessageId);
      if (entry === undefined) throw new Error(`Nothing queued as ${queuedMessageId}`);
      Object.assign(entry, { state: "failed_exhausted", failureReason: "The provider exited before the turn started" });
    },
    dispose: () => disposers.forEach((hook) => hook()),
    memoryWrites: () => [...memoryWrites],
    bindings: () => bindings,
    metadataOf(threadId: string): Metadata {
      const value = metadata.get(threadId);
      if (value === undefined) throw new Error(`No thread ${threadId}`);
      return value;
    },
    async threadCreated(thread: ThreadRef, pluginMetadata: Metadata): Promise<void> {
      metadata.set(thread.id, pluginMetadata);
      await emit("thread.created", { thread });
    },
    configurationFor(threadId: string, pluginMetadata: PluginAgentConfigurationContext["pluginMetadata"]): PluginAgentConfiguration {
      if (configure === null) throw new Error("No configure callback");
      return configure(configurationContext(threadId, pluginMetadata));
    },
    tools: () => [...tools].map(([name, { parameters, instructions }]) => ({ name, parameters, instructions })),
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
  const { threadId } = await kit.startManager("Migrate the webhook service", { verify });
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

/** What the New page creates a regional manager named `name` with: no description and the default icon. */
export const profileNamed = (name: string): Profile => ({ name, description: null, avatar: DEFAULT_AVATAR });

/**
 * What bb's composer on a regional manager's page submits for this goal, as bb's RPC hands it to the
 * plugin, parsed by the contract: a fresh worktree from the default branch, on claude-code opus (high), on auto.
 */
export function newThreadRequest(goal: string): ComposerRequest {
  return {
    projectId: "prj_1",
    providerId: "claude-code",
    model: "opus",
    reasoningLevel: "high",
    permissionMode: "auto",
    environment: { type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
    input: [{ type: "text", text: goal, mentions: [] }],
  };
}

/** A tool result's text, whichever form it took. */
export const textOf = (result: PluginAgentToolResult): string => (typeof result === "string" ? result : result.content.map((part) => (part.type === "text" ? part.text : "")).join(""));

export const isRefusal = (result: PluginAgentToolResult): boolean => typeof result !== "string" && result.isError === true;

function manifestSkillIds(): string[] {
  const root = join(import.meta.dirname, "../..");
  const manifest = z.object({ bb: z.object({ skills: z.array(z.string()) }) }).parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  return manifest.bb.skills.flatMap((dir) => readdirSync(join(root, dir)));
}

function configurationContext(threadId: string, pluginMetadata: PluginAgentConfigurationContext["pluginMetadata"]): PluginAgentConfigurationContext {
  return {
    pluginMetadata,
    thread: { id: threadId, title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: "prj_1", kind: "standard", name: PROJECT_NAME, gitRemoteUrl: null },
    environment: { id: "env_1", name: null, path: "/work/webhooks", branchName: "main", workspaceProvisionType: null },
    host: { id: "host_1", name: "This Mac" },
    provider: { id: "claude-code", model: "opus", capabilities: { supportsNativeUserQuestion: true } },
    origin: { kind: null, pluginId: null },
  };
}

const PROJECT_NAME = "Webhooks";

/** A build issue as most tests file it: a brief, and one done-criterion. */
export const ISSUE = { kind: "build", title: "Add retries", description: "Failed webhook deliveries are lost.", brief: "Retry failed deliveries with backoff.", doneCriteria: ["npm test passes"] };

/** The id issue_create's answer names. */
export const issueIn = (text: string): string => /Filed ([A-Z]+-\d+)/.exec(text)?.[1] ?? assert.fail(`no issue filed: ${text}`);

/**
 * The regional manager `threadId` files an issue (ISSUE, with `fields` over it) and starts an agent
 * on it (with `start` added to agent_start's input); returns the issue's id and the agent's thread.
 */
export async function startedAgent(kit: ReturnType<typeof harness>, threadId: string, fields: object = {}, start: object = {}): Promise<{ issue: string; agentThreadId: string }> {
  const issue = issueIn(textOf(await kit.call("issue_create", { ...ISSUE, ...fields }, threadId)));
  return { issue, agentThreadId: threadIn(textOf(await kit.call("agent_start", { issue, ...start }, threadId))) };
}
