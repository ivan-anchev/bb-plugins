import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "./contract.ts";
import { coordinatorStart, newThreadRequest } from "./server/test-harness.ts";

const startInput = coordinatorContract.startCoordinator.input;

test("a start whose text part has no text is refused before it reaches the plugin", () => {
  const request = { projectId: "prj_1", input: [{ type: "text", text: 123 }] };
  assert.equal(startInput.safeParse({ ...coordinatorStart("Migrate the webhook service"), request }).success, false);
});

test("a start passes on everything it does not read, unchanged", () => {
  const request = { ...newThreadRequest("Migrate the webhook service"), sendAt: 5 };
  request.input.push({ type: "image", url: "https://example.com/plan.png" });
  const start = { ...coordinatorStart("Migrate the webhook service", false), request };
  assert.deepEqual(startInput.parse(start), start);
});
