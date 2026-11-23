import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, type Agent } from "../../../model/agent/agent.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import type { HolderThread } from "../../../model/issue/status.ts";
import { coordinatorIdSchema, type CoordinatorId, type Role } from "../../../model/role.ts";
import { forwardThreadEvents } from "./thread-events.ts";

const PLUGIN_ID = "regional-manager";
const [MANAGER, OTHER_MANAGER] = [coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000001"), coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000002")];

// why a status on every event: bb's lifecycle events carry the thread too; the forwarder reads it only from the thread's own event.
type Payload = { thread: { id: string; originPluginId: string | null; status: HolderThread["status"] } };

/** MANAGER's a1, which held WEB-1 and was stopped: its thread is linked from WEB-1's feed while bb has it. */
const ENDED_A1: Agent = {
  id: agentIdSchema.parse("a1"),
  coordinatorId: MANAGER,
  issueId: issueIdSchema.parse("WEB-1"),
  placement: { kind: "worktree" },
  base: { kind: "default" },
  execution: { providerId: "codex", model: "gpt-5.4", reasoningLevel: "medium" },
  threadId: "a1",
  checkout: { environmentId: null, branch: null, head: null },
  fixRounds: 0,
  startedAt: 1_000,
  ended: { how: "stopped", at: 2_000, left: null },
};

/** forwardThreadEvents over a fake bb: thread `a1` is MANAGER's agent, `b1` OTHER_MANAGER's. What it calls is recorded in order. */
function forwarded() {
  const handlers = new Map<string, ((payload: Payload) => void | Promise<void>)[]>();
  const calls: string[] = [];
  const roles = new Map<string, Role>([
    ["a1", { kind: "agent", coordinatorId: MANAGER, agentId: agentIdSchema.parse("a1") }],
    ["b1", { kind: "agent", coordinatorId: OTHER_MANAGER, agentId: agentIdSchema.parse("a1") }],
  ]);
  const forwarding = forwardThreadEvents(
    {
      pluginId: PLUGIN_ID,
      log: { warn: () => undefined },
      events: { on: (event: string, handler: (payload: Payload) => void | Promise<void>) => void handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    },
    {
      store: { roleOfThread: (threadId) => roles.get(threadId) ?? null, agent: (id, agentId) => (id === MANAGER && agentId === "a1" ? ENDED_A1 : null) },
      agents: { archived: async () => undefined, deleted: async () => undefined, remove: () => undefined },
      verify: { lookAgain: async () => undefined },
      onChange: (id: CoordinatorId) => void calls.push(`change ${id === MANAGER ? "manager" : "other"}`),
      refreshBoard: (id: CoordinatorId) => void calls.push(`board ${id === MANAGER ? "manager" : "other"}`),
      refreshIssue: (id: CoordinatorId, issueId) => void calls.push(`issue ${id === MANAGER ? "manager" : "other"} ${issueId}`),
    },
  );
  const emit = (event: string, threadId: string, status: HolderThread["status"]) => handlers.get(event)?.forEach((handler) => void handler({ thread: { id: threadId, originPluginId: PLUGIN_ID, status } }));
  return {
    forget: forwarding.forget,
    calls,
    now: (threadId: string, status: HolderThread["status"]) => emit("experimental_thread.events", threadId, status),
    lifecycle: (threadId: string) => emit("thread.idle", threadId, "idle"),
    deleted: (threadId: string) => emit("thread.deleted", threadId, "idle"),
  };
}

test("a thread's status repeated refreshes the board alone; one after a lifecycle event, or after its manager is forgotten, is news again", () => {
  const { forget, calls, now, lifecycle } = forwarded();
  now("a1", "idle");
  now("b1", "idle");
  now("a1", "idle");
  assert.deepEqual(calls.splice(0), ["change manager", "change other", "board manager"]);

  lifecycle("a1");
  now("a1", "idle");
  assert.deepEqual(calls.splice(0), ["change manager", "change manager"]);

  // why: a removed manager's idle agent threads send nothing more, so what was seen of them goes with the manager, and only its.
  forget(MANAGER);
  now("a1", "idle");
  now("b1", "idle");
  assert.deepEqual(calls.splice(0), ["change manager", "board other"]);
});

test("an ended agent's thread deleted reads its issue's feed again, as only bb's listing says it is gone; another manager's thread names its own", () => {
  const { calls, deleted } = forwarded();
  deleted("a1");
  assert.deepEqual(calls.splice(0).filter((call) => call.startsWith("issue")), ["issue manager WEB-1"]);
  deleted("b1");
  assert.deepEqual(calls.splice(0).filter((call) => call.startsWith("issue")), [], "b1's agent isn't on record here, so it names no issue");
});
