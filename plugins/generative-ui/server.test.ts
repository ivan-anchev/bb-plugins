import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk";
import plugin from "./server.ts";

const CONFIGURE_INSTRUCTIONS_LIMIT = 4096;

test("a top-level thread gets the rule and the skill", () => {
  const configuration = configureFor({});
  assert.match(configuration.instructions ?? "", /`openui`/);
  assert.deepEqual(configuration.skills, ["generative-ui"]);
});

test("a side chat gets the rule and the skill", () => {
  const sideChat = { origin: { kind: "fork", pluginId: "side-chat" } } as const;
  assert.deepEqual(configureFor(sideChat).skills, ["generative-ui"]);
});

test("a subagent thread gets nothing", () => {
  const subagent = { thread: { ...baseContext.thread, parentThreadId: "thr_parent" } };
  assert.deepEqual(configureFor(subagent), { tools: [], skills: [] });
});

test("a plugin-run thread gets nothing", () => {
  const workflowStep = { origin: { kind: null, pluginId: "workflows" } };
  assert.deepEqual(configureFor(workflowStep), { tools: [], skills: [] });
});

test("the rule fits within bb's instruction limit", () => {
  const length = configureFor({}).instructions?.length ?? 0;
  assert.ok(length <= CONFIGURE_INSTRUCTIONS_LIMIT, `${length} characters`);
});

function configureFor(
  overrides: Partial<PluginAgentConfigurationContext>,
): PluginAgentConfiguration {
  let configure: ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration) | undefined;
  plugin({ agents: { configure: (provider) => (configure = provider) } });
  assert.ok(configure, "plugin registered no configure hook");
  return configure({ ...baseContext, ...overrides });
}

const baseContext: PluginAgentConfigurationContext = {
  pluginMetadata: {},
  thread: { id: "thr_1", title: null, parentThreadId: null, sourceThreadId: null },
  project: { id: "proj_1", kind: "standard", name: "demo", gitRemoteUrl: null },
  environment: {
    id: "env_1",
    name: null,
    path: "/work/demo",
    branchName: "main",
    workspaceProvisionType: null,
  },
  host: { id: "host_1", name: "laptop" },
  provider: {
    id: "claude-code",
    model: "claude-opus-5-5",
    capabilities: { supportsNativeUserQuestion: true },
  },
  origin: { kind: null, pluginId: null },
};
