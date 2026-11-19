import assert from "node:assert/strict";
import { test } from "node:test";
import { newSeed } from "./new-seed.ts";

type Model = { model: string; isDefault: boolean; defaultReasoningEffort: string };

/** bb as the seed reads it: its config, and per provider whether it is available and its models (an Error: bb can't load them). */
function fakeBb(defaultProviderId: string | null, providers: { id: string; available: boolean; models: Model[] | Error }[], primaryHostId: string | null = "host_1") {
  const routings: unknown[] = [];
  const warnings: string[] = [];
  const bb = {
    log: { warn: (message: string) => void warnings.push(message) },
    sdk: {
      system: { config: async () => ({ primaryHostId, generalSettings: { defaultProviderId } }) },
      providers: {
        list: async (routing: object) => {
          routings.push(routing);
          return providers.map(({ id, available }) => ({ id, available }));
        },
        models: async ({ providerId }: { providerId: string }) => {
          const models = providers.find(({ id }) => id === providerId)?.models ?? [];
          if (models instanceof Error) throw models;
          return { modelLoadError: null, models };
        },
      },
    },
  };
  return { bb, routings, warnings };
}

const OPUS = { model: "opus", isDefault: true, defaultReasoningEffort: "high" };
const SONNET = { model: "sonnet", isDefault: false, defaultReasoningEffort: "medium" };

test("seeds bb's default provider on its default model and reasoning, read on the machine running bb", async () => {
  const { bb, routings } = fakeBb("claude-code", [
    { id: "codex", available: true, models: [{ model: "gpt", isDefault: true, defaultReasoningEffort: "medium" }] },
    { id: "claude-code", available: true, models: [SONNET, OPUS] },
  ]);
  assert.deepEqual(await newSeed(bb), { hostId: "host_1", execution: { providerId: "claude-code", model: "opus", reasoningLevel: "high" } });
  assert.deepEqual(routings, [{ hostId: "host_1" }]);
});

test("with no default bb can run, the first provider it can; with no default model, the first model", async () => {
  const { bb } = fakeBb("pi", [
    { id: "pi", available: false, models: [] },
    { id: "claude-code", available: true, models: [{ ...SONNET }, { ...OPUS, isDefault: false }] },
  ]);
  assert.deepEqual((await newSeed(bb)).execution, { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium" });
});

test("with no provider bb can run, or no model it can load, there is no execution to seed; with no machine, bb's own routing", async () => {
  assert.deepEqual(await newSeed(fakeBb(null, [{ id: "pi", available: false, models: [] }]).bb), { hostId: "host_1", execution: null });
  const failing = fakeBb(null, [{ id: "claude-code", available: true, models: new Error("timeout") }], null);
  assert.deepEqual(await newSeed(failing.bb), { hostId: null, execution: null });
  assert.deepEqual(failing.routings, [{}]);
  assert.equal(failing.warnings.length, 1);
});
