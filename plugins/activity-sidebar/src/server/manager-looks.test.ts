import assert from "node:assert/strict";
import { test } from "node:test";
import { MANAGER_LOOKS_TAG } from "../contract.ts";
import { openManagerLooks } from "./manager-looks.ts";

const AVATAR = { kind: "blob", shape: "bear", hue: "violet", expression: "attentive" } as const;

/** The Regional Manager plugin's answer, as it publishes it: more than the sidebar reads. */
const ANSWER = {
  coordinators: [
    { id: "mgr_1", threadId: "thr_pr", projectId: "prj_a", description: "Reviews every open pull request.", avatar: AVATAR },
    { id: "mgr_2", threadId: "thr_sb", projectId: "prj_a", description: null, avatar: { ...AVATAR, shape: "bunny", hue: "rose" } },
  ],
  notStarted: [{ id: "mgr_3", name: "Docs", description: null, avatar: AVATAR }],
};

// bb's callRpc stands in as the plugin's answer (or its failure), parsed with the caller's outputSchema as bb does.
function harness(answer: () => Promise<unknown>) {
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

test("no looks, and a warning, when the plugin is missing or fails: each manager keeps its name and a plain avatar", async () => {
  const { looks, warnings } = harness(async () => {
    throw new Error('plugin "regional-manager" is not installed');
  });
  assert.deepEqual(await looks.read(), { looks: [] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not installed/);
});

test("no looks when the plugin answers in a shape this copy of its schema doesn't know", async () => {
  for (const answer of [
    { managers: [] },
    { coordinators: [{ threadId: "thr_pr", description: null }] },
    { coordinators: [{ threadId: "thr_pr", description: null, avatar: { ...AVATAR, shape: "octagon" } }] },
    { coordinators: [{ thread: "thr_pr", description: null, avatar: AVATAR }] },
  ]) {
    const { looks, warnings } = harness(async () => answer);
    assert.deepEqual(await looks.read(), { looks: [] }, JSON.stringify(answer));
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

test("a manager retitled marks the looks stale, as its profile edit may have changed its description too", async () => {
  const { looks, invalidated } = harness(async () => ANSWER);
  looks.retitled("thr_pr");
  assert.deepEqual(invalidated, [], "before any read, no thread is known to be a manager");

  await looks.read();
  looks.retitled("thr_other");
  looks.retitled("thr_pr");
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG]);
});
