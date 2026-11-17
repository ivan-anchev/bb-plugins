import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogRouting, executionOf, type ExecutionFacts } from "./execution.ts";

const facts: ExecutionFacts = {
  providers: [
    { id: "claude-code", available: true },
    { id: "codex", available: true },
    { id: "pi", available: false },
  ],
  models: [
    { model: "gpt-5.4", isDefault: true, defaultReasoningEffort: "medium" },
    { model: "gpt-5.4-mini", isDefault: false, defaultReasoningEffort: "low" },
  ],
};

test("a named model bb lists runs at the reasoning level named, else at the model's default", () => {
  assert.deepEqual(executionOf({ providerId: "codex", model: "gpt-5.4", reasoningLevel: "high" }, facts), { providerId: "codex", model: "gpt-5.4", reasoningLevel: "high" });
  assert.deepEqual(executionOf({ providerId: "codex", model: "gpt-5.4-mini" }, facts), { providerId: "codex", model: "gpt-5.4-mini", reasoningLevel: "low" });
});

test("an unknown or unavailable provider is refused naming the providers bb can run there", () => {
  assert.deepEqual(executionOf({ providerId: "gemini", model: "x" }, facts), { refused: "bb can't run gemini there. It can run: claude-code, codex." });
  assert.deepEqual(executionOf({ providerId: "pi", model: "x" }, facts), { refused: "bb can't run pi there. It can run: claude-code, codex." });
});

test("a model the provider's catalog doesn't list is refused naming its models, the default marked, and the providers bb can run there", () => {
  assert.deepEqual(executionOf({ providerId: "codex", model: "gpt-4" }, facts), { refused: "codex has no model gpt-4 there. Its models: gpt-5.4 (default), gpt-5.4-mini. bb can run: claude-code, codex." });
});

test("a provider whose models bb can't load there is refused", () => {
  assert.deepEqual(executionOf({ providerId: "codex", model: "gpt-5.4" }, { ...facts, models: [] }), { refused: "bb can't load codex's models there. It can run: claude-code, codex." });
});

test("a catalog is read where the thread will be spawned: a joined environment, a worktree's machine, else bb's primary machine", () => {
  assert.deepEqual(catalogRouting({ type: "reuse", environmentId: "env_1" }), { environmentId: "env_1" });
  assert.deepEqual(catalogRouting({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }), { hostId: "host_1" });
  assert.deepEqual(catalogRouting({ type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }), {});
  assert.deepEqual(catalogRouting({ type: "provider", environmentProviderId: "boat-sandbox", inputs: {} }), {});
});
