// Tests only: the server's modules wired as server.ts wires them, over an in-memory database, a
// temporary memory folder and a fake bb that records what the plugin registers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { openMemoryRoot } from "./memory/memory-files.ts";
import { memoryStorage } from "./memory-storage.ts";
import { registerRoles } from "./roles.ts";
import { createSpawner } from "./spawn.ts";
import { openStore } from "./store.ts";
import { registerCoordinatorTools } from "./tools/coordinator-tools.ts";

const PLUGIN_ID = "coordinator";

type SpawnBb = Parameters<typeof createSpawner>[0];
type ToolsBb = Parameters<typeof registerCoordinatorTools>[0];
type CreatedHandler = Parameters<SpawnBb["events"]["on"]>[1];
type Metadata = Awaited<ReturnType<SpawnBb["sdk"]["threads"]["getPluginMetadata"]>>;

/**
 * How the fake bb answers a spawn. `created` delivers `thread.created` for the new thread, as bb does
 * before its spawn answer; `answer` is that answer: the thread, or lost (the call rejects).
 */
type SpawnBehaviour = { created: boolean; answer: "thread" | "lost" };

export function harness(behaviour: SpawnBehaviour = { created: true, answer: "thread" }) {
  const store = openStore(memoryStorage().storage);
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-test-")), "data.db"));
  const metadata = new Map<string, Metadata>();
  const tools = new Map<string, (input: unknown, threadId: string) => Promise<PluginAgentToolResult>>();
  let configure: ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration) | null = null;
  let onCreated: CreatedHandler | null = null;
  let spawned = 0;
  let bindings = 0;

  const threads: SpawnBb["sdk"]["threads"] = {
    async spawn(args) {
      const id = `thr_${++spawned}`;
      metadata.set(id, args.pluginMetadata ?? {});
      if (behaviour.created) await created({ id, originPluginId: PLUGIN_ID });
      if (behaviour.answer === "lost") throw new Error("socket hang up");
      return { id };
    },
    getPluginMetadata: async ({ threadId }) => {
      const value = metadata.get(threadId);
      if (value === undefined) throw new Error(`No thread ${threadId}`);
      return value;
    },
  };
  const agents: ToolsBb["agents"] & Parameters<typeof registerRoles>[0]["agents"] = {
    registerTool(tool) {
      tools.set(tool.name, async (input, threadId) => tool.execute(tool.parameters.parse(input), { threadId, projectId: "prj_1", signal: new AbortController().signal }));
    },
    configure(provider) {
      configure = provider;
    },
  };
  const bb = { pluginId: PLUGIN_ID, sdk: { threads }, events: { on: (_event: "thread.created", handler: CreatedHandler) => void (onCreated = handler) }, agents };

  const spawner = createSpawner(bb, store, memory, () => bindings++);
  registerRoles(bb, store);
  registerCoordinatorTools(bb, store, memory);

  async function created(thread: { id: string; originPluginId: string | null }): Promise<void> {
    if (onCreated === null) throw new Error("No thread.created handler");
    await onCreated({ thread });
  }

  return {
    store,
    memory,
    spawner,
    /** How many times a ticket was newly bound. */
    bindings: () => bindings,
    /** The metadata a spawned thread was given. */
    metadataOf(threadId: string): Metadata {
      const value = metadata.get(threadId);
      if (value === undefined) throw new Error(`No thread ${threadId}`);
      return value;
    },
    /** bb's thread.created event, for a thread it made with these metadata. */
    async threadCreated(thread: { id: string; originPluginId: string | null }, pluginMetadata: Metadata): Promise<void> {
      metadata.set(thread.id, pluginMetadata);
      await created(thread);
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
