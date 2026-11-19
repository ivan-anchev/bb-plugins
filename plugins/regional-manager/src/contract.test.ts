import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "./contract.ts";
import { coordinatorStart, MANAGER_REQUEST } from "./server/test-harness.ts";

const startInput = coordinatorContract.startCoordinator.input;

test("a start with no permission mode bb knows, or with no environment, is refused before it reaches the plugin", () => {
  assert.equal(startInput.safeParse({ ...coordinatorStart("Webhooks"), request: { ...MANAGER_REQUEST, permissionMode: "yolo" } }).success, false);
  const { environment: _, ...placeless } = MANAGER_REQUEST;
  assert.equal(startInput.safeParse({ ...coordinatorStart("Webhooks"), request: placeless }).success, false);
});

test("a start passes the environment on unchanged, everything in it that the plugin doesn't read included", () => {
  const request = { ...MANAGER_REQUEST, serviceTier: "fast", environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "release/2" } } } };
  const start = { ...coordinatorStart("Webhooks", false), request };
  assert.deepEqual(startInput.parse(start), start);
});

test("a start carries no goal: text sent along with it is dropped before it reaches the plugin", () => {
  const parsed = startInput.parse({ ...coordinatorStart("Webhooks"), request: { ...MANAGER_REQUEST, input: [{ type: "text", text: "Migrate the webhook service", mentions: [] }] } });
  assert.deepEqual(parsed.request, MANAGER_REQUEST);
});
