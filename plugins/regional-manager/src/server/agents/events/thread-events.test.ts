import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../../model/agent.ts";
import type { HolderThread } from "../../../model/issue/status.ts";
import { coordinatorIdSchema, type CoordinatorId, type Role } from "../../../model/role.ts";
import { forwardThreadEvents } from "./thread-events.ts";

const PLUGIN_ID = "regional-manager";
const [MANAGER, OTHER_MANAGER] = [coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000001"), coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000002")];

type Payload = { thread: { id: string; originPluginId: string | null; status: HolderThread["status"] } };

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
      store: { roleOfThread: (threadId) => roles.get(threadId) ?? null, agent: () => null },
      agents: { archived: async () => undefined, deleted: async () => undefined, remove: () => undefined },
      verify: { lookAgain: async () => undefined },
      onChange: (id: CoordinatorId) => void calls.push(`change ${id === MANAGER ? "manager" : "other"}`),
      refreshBoard: (id: CoordinatorId) => void calls.push(`board ${id === MANAGER ? "manager" : "other"}`),
    },
  );
  const emit = (event: string, threadId: string, status: HolderThread["status"]) => handlers.get(event)?.forEach((handler) => void handler({ thread: { id: threadId, originPluginId: PLUGIN_ID, status } }));
  return { forget: forwarding.forget, calls, now: (threadId: string, status: HolderThread["status"]) => emit("experimental_thread.events", threadId, status), lifecycle: (threadId: string) => emit("thread.idle", threadId, "idle") };
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

  forget(MANAGER);
  now("a1", "idle");
  now("b1", "idle");
  assert.deepEqual(calls.splice(0), ["change manager", "board other"]);
});
