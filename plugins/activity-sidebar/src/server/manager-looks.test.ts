import assert from "node:assert/strict";
import { test } from "node:test";
import { MANAGER_LOOKS_TAG } from "../contract.ts";
import { AVATAR, COORDINATORS as ANSWER, MALFORMED_COORDINATORS as MALFORMED } from "../model/fixtures.ts";
import { openManagerLooks } from "./manager-looks.ts";

type Thread = { originPluginId: string | null; parentThreadId: string | null };

// bb's callRpc stands in as the plugin's answer (or its failure), parsed with the caller's outputSchema
// as bb does; bb's threads as a map, answering 404 for one it doesn't hold, as bb does.
function harness(answer: () => Promise<unknown>, held: Record<string, Thread> = {}) {
  const calls: unknown[] = [];
  const invalidated: string[] = [];
  const warnings: string[] = [];
  const looks = openManagerLooks({
    plugins: {
      callRpc: async ({ outputSchema, ...call }) => {
        calls.push(call);
        return outputSchema.parse(await answer());
      },
    },
    threads: {
      get: async ({ threadId }) => {
        const thread = held[threadId];
        if (thread === undefined) throw new Error(`HTTP 404: thread ${threadId} not found`);
        return thread;
      },
    },
    rpc: { experimental_invalidate: (tags) => void invalidated.push(...tags) },
    log: { warn: (message) => void warnings.push(message) },
  });
  return { looks, calls, invalidated, warnings };
}

test("reads each started manager's thread, description and avatar from the Regional Manager plugin", async () => {
  const { looks, calls } = harness(async () => ANSWER);
  assert.deepEqual(await looks.read(), {
    looks: [
      { threadId: "thr_pr", description: "Reviews every open pull request.", avatar: AVATAR },
      { threadId: "thr_sb", description: null, avatar: { ...AVATAR, shape: "bunny", hue: "rose" } },
    ],
  });
  assert.deepEqual(calls, [{ pluginId: "regional-manager", method: "coordinators", input: {} }]);
});

test("no looks, and a warning, whenever the plugin is missing or fails, even after a good read", async () => {
  let fail = false;
  const { looks, warnings } = harness(async () => {
    if (fail) throw new Error('plugin "regional-manager" is not installed');
    return ANSWER;
  });
  assert.equal((await looks.read()).looks.length, 2);
  fail = true;
  assert.deepEqual(await looks.read(), { looks: [] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not installed/);
});

test("no looks whenever the plugin answers in a shape this copy of its schema doesn't know, even after a good read", async () => {
  for (const malformed of MALFORMED) {
    let answer: unknown = ANSWER;
    const { looks, warnings } = harness(async () => answer);
    assert.equal((await looks.read()).looks.length, 2);
    answer = malformed;
    assert.deepEqual(await looks.read(), { looks: [] }, JSON.stringify(malformed));
    assert.equal(warnings.length, 1);
  }
});

test("a manager's thread created, archived, unarchived or deleted marks the looks stale; any other thread doesn't", () => {
  const { looks, invalidated } = harness(async () => ANSWER);
  looks.changed({ originPluginId: "regional-manager", parentThreadId: null });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG]);

  looks.changed({ originPluginId: "regional-manager", parentThreadId: "thr_pr" });
  looks.changed({ originPluginId: null, parentThreadId: null });
  looks.changed({ originPluginId: "notes", parentThreadId: null });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG], "an agent of a manager, or another thread, changes no look");
});

test("a manager retitled marks the looks stale, before any read too; another thread retitled, or a manager's other change, doesn't", async () => {
  const { looks, invalidated, warnings } = harness(async () => ANSWER, {
    thr_new: { originPluginId: "regional-manager", parentThreadId: null },
    thr_agent: { originPluginId: "regional-manager", parentThreadId: "thr_new" },
    thr_plain: { originPluginId: null, parentThreadId: null },
  });
  await looks.threadChanged({ id: "thr_new", changes: ["status-changed", "title-changed"] });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG], "a manager no read has seen yet");

  await looks.threadChanged({ id: "thr_new", changes: ["status-changed", "read-state-changed"] });
  await looks.threadChanged({ id: "thr_agent", changes: ["title-changed"] });
  await looks.threadChanged({ id: "thr_plain", changes: ["title-changed"] });
  await looks.threadChanged({ changes: ["title-changed"] });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG]);

  await looks.threadChanged({ id: "thr_gone", changes: ["title-changed"] });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG], "a thread bb no longer holds changes nothing");
  assert.match(warnings[0] ?? "", /thr_gone/);
});
