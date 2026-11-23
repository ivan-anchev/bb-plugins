import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogRouting, executionOf, runnableText, type ExecutionFacts } from "./execution.ts";

const facts: ExecutionFacts = {
  providers: [
    { id: "claude-code", available: true },
    { id: "codex", available: true },
    { id: "pi", available: false },
  ],
  models: [
    { model: "gpt-5.4", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }, { reasoningEffort: "xhigh" }] },
    { model: "gpt-5.4-mini", isDefault: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "minimal" }, { reasoningEffort: "low" }, { reasoningEffort: "medium" }] },
    { model: "gpt-5.4-nano", isDefault: false, defaultReasoningEffort: "minimal", supportedReasoningEfforts: [{ reasoningEffort: "minimal" }, { reasoningEffort: "low" }] },
    { model: "gpt-5.4-unknown", isDefault: false, defaultReasoningEffort: "", supportedReasoningEfforts: [] },
  ],
};

test("a named model bb lists runs at the reasoning level named, even low, else at high, never its low default", () => {
  const level = (model: string, reasoningLevel?: string) => {
    const resolved = executionOf({ providerId: "codex", model, reasoningLevel }, facts);
    return "refused" in resolved ? assert.fail(resolved.refused) : resolved.reasoningLevel;
  };
  assert.equal(level("gpt-5.4", "low"), "low", "a level named is passed through, as tests and throwaway threads name low");
  assert.equal(level("gpt-5.4", "xhigh"), "xhigh");
  assert.equal(level("gpt-5.4"), "high");
  assert.equal(level("gpt-5.4-mini"), "medium", "with no high, the highest level it lists below high");
  assert.equal(level("gpt-5.4-nano"), "minimal", "with nothing above low, its default");
  assert.equal(level("gpt-5.4-unknown"), "", "with no levels listed, its default, as bb gives it");
});

test("an unknown or unavailable provider is refused", () => {
  assert.deepEqual(executionOf({ providerId: "gemini", model: "x" }, facts), { refused: "bb can't run gemini there." });
  assert.deepEqual(executionOf({ providerId: "pi", model: "x" }, facts), { refused: "bb can't run pi there." });
});

test("a model the provider's catalog doesn't list is refused naming its models, the default marked", () => {
  assert.deepEqual(executionOf({ providerId: "codex", model: "gpt-4" }, facts), { refused: "codex has no model gpt-4 there. Its models: gpt-5.4 (default), gpt-5.4-mini, gpt-5.4-nano, gpt-5.4-unknown." });
});

test("a provider whose models bb can't load there is refused", () => {
  assert.deepEqual(executionOf({ providerId: "codex", model: "gpt-5.4" }, { ...facts, models: [] }), { refused: "bb can't load codex's models there." });
});

test("a refusal names the providers bb can run there, or that it can run none", () => {
  assert.equal(runnableText(["claude-code", "codex"]), "bb can run: claude-code, codex.");
  assert.equal(runnableText([]), "bb can run no provider there.");
});

test("a catalog is read where the thread will be spawned: a joined environment, a worktree's machine, else bb's primary machine", () => {
  assert.deepEqual(catalogRouting({ type: "reuse", environmentId: "env_1" }), { environmentId: "env_1" });
  assert.deepEqual(catalogRouting({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }), { hostId: "host_1" });
  assert.deepEqual(catalogRouting({ type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }), {});
  assert.deepEqual(catalogRouting({ type: "provider", environmentProviderId: "boat-sandbox", inputs: {} }), {});
});
