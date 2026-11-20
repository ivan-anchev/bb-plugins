import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract, typedText } from "./contract.ts";
import { newThreadRequest } from "./server/test-harness.ts";

const startInput = coordinatorContract.startCoordinator.input;
const COORDINATOR = "6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10";

test("a start whose text part has no text, or with no project, is refused before it reaches the plugin", () => {
  assert.equal(startInput.safeParse({ coordinatorId: COORDINATOR, request: { projectId: "prj_1", input: [{ type: "text", text: 123 }] } }).success, false);
  const { projectId: _, ...projectless } = newThreadRequest("Migrate the webhook service");
  assert.equal(startInput.safeParse({ coordinatorId: COORDINATOR, request: projectless }).success, false);
});

test("a start keeps the composer's fields, attachments and a scheduled send included, and drops every other, executionInputSources too", () => {
  const request = { ...newThreadRequest("Migrate the webhook service"), sendAt: 5, serviceTier: "fast" };
  request.input.push({ type: "image", url: "https://example.com/plan.png" });
  const parsed = startInput.parse({ coordinatorId: COORDINATOR, request: { ...request, executionInputSources: { permissionMode: "explicit" }, visibility: "hidden", lifecycleOwnerThreadId: "thr_9" } });
  assert.deepEqual(parsed, { coordinatorId: COORDINATOR, request });
});

test("a start with no text to be its goal is refused", () => {
  for (const input of [[], [{ type: "text", text: "  ", mentions: [] }], [{ type: "image", url: "https://example.com/plan.png" }]]) {
    assert.equal(startInput.safeParse({ coordinatorId: COORDINATOR, request: { ...newThreadRequest(""), input } }).success, false, JSON.stringify(input));
  }
});

test("the goal is the text typed in the composer, every text part in order, and nothing else", () => {
  const request = newThreadRequest("Migrate the webhook service");
  request.input.push({ type: "image", url: "https://example.com/plan.png" }, { type: "text", text: "Keep the old endpoints.", mentions: [] });
  assert.equal(typedText(request), "Migrate the webhook service\n\nKeep the old endpoints.");
});
