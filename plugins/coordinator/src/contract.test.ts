import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "./contract.ts";
import { newThreadRequest } from "./server/test-harness.ts";

const startInput = coordinatorContract.startCoordinator.input;

test("a start whose text part has no text is refused before it reaches the plugin", () => {
  const request = { projectId: "prj_1", input: [{ type: "text", text: 123 }] };
  assert.equal(startInput.safeParse({ request, verify: true }).success, false);
});

test("a start passes on everything it does not read, unchanged", () => {
  const request = { ...newThreadRequest("Migrate the webhook service"), sendAt: 5 };
  request.input.push({ type: "image", url: "https://example.com/plan.png" });
  assert.deepEqual(startInput.parse({ request, verify: false }), { request, verify: false });
});
