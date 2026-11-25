import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { MANAGER_LOOKS_TAG } from "../contract.ts";
import { AVATAR, COORDINATORS as ANSWER, MALFORMED_COORDINATORS as MALFORMED } from "../model/fixtures.ts";
import { BIND_RETRY_MS, openManagerLooks } from "./manager-looks.ts";

type Thread = { originPluginId: string | null; parentThreadId: string | null };
type ThreadGet = (args: { threadId: string; signal: AbortSignal }) => Promise<Thread>;

afterEach(() => mock.timers.reset());

// bb's callRpc stands in as the plugin's answer (or its failure), parsed with the caller's outputSchema
// as bb does; bb's threads as a map, answering 404 for one it doesn't hold, as bb does (or `get`).
function harness(answer: () => Promise<unknown>, held: Record<string, Thread> = {}, get?: ThreadGet) {
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
      get:
        get ??
        (async ({ threadId }) => {
          const thread = held[threadId];
          if (thread === undefined) throw new Error(`HTTP 404: thread ${threadId} not found`);
          return thread;
        }),
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
  looks.created({ id: "thr_new", originPluginId: "regional-manager", parentThreadId: null });
  looks.changed({ originPluginId: "regional-manager", parentThreadId: null });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG, MANAGER_LOOKS_TAG]);

  looks.created({ id: "thr_agent", originPluginId: "regional-manager", parentThreadId: "thr_pr" });
  looks.changed({ originPluginId: "regional-manager", parentThreadId: "thr_pr" });
  looks.changed({ originPluginId: null, parentThreadId: null });
  looks.changed({ originPluginId: "notes", parentThreadId: null });
  assert.deepEqual(invalidated, [MANAGER_LOOKS_TAG, MANAGER_LOOKS_TAG], "an agent of a manager, or another thread, changes no look");
});

const NEW = { id: "thr_new", originPluginId: "regional-manager", parentThreadId: null } as const;
const BOUND = { coordinators: [...ANSWER.coordinators, { ...ANSWER.coordinators[0], id: "mgr_4", threadId: "thr_new" }] };

test("a new manager read before its profile is bound is read again shortly, until its look shows", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let answer: unknown = ANSWER;
  const { looks, invalidated } = harness(async () => answer);

  looks.created(NEW);
  assert.equal(invalidated.length, 1, "its creation asks every client to read");
  await looks.read();
  mock.timers.tick(BIND_RETRY_MS);
  assert.equal(invalidated.length, 2, "read before the bind, so read again");

  answer = BOUND;
  assert.ok((await looks.read()).looks.some(({ threadId }) => threadId === "thr_new"));
  mock.timers.tick(BIND_RETRY_MS * 5);
  assert.equal(invalidated.length, 2, "its look showed: no more reads");
});

test("a new manager whose look never shows is read again at most twice", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { looks, invalidated } = harness(async () => ANSWER);
  looks.created(NEW);
  for (let read = 0; read < 5; read++) {
    await looks.read();
    mock.timers.tick(BIND_RETRY_MS);
  }
  assert.equal(invalidated.length, 1 + 2);
});

test("disposed, a re-read waiting for a new manager's bind never fires", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { looks, invalidated } = harness(async () => ANSWER);
  looks.created(NEW);
  await looks.read();
  looks.dispose();
  mock.timers.tick(BIND_RETRY_MS * 5);
  assert.equal(invalidated.length, 1);
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

test("disposed while a rename's thread lookup is under way: the lookup is aborted, and nothing is invalidated or logged", async () => {
  // bb's get rejects once its signal aborts; the second fake ignores the signal and answers late, to show a late answer is dropped too.
  const pending: { signal: AbortSignal; answer(thread: Thread): void }[] = [];
  const rejecting: ThreadGet = ({ signal }) =>
    new Promise((answer, fail) => {
      pending.push({ signal, answer });
      signal.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
    });
  const answeringLate: ThreadGet = ({ signal }) => new Promise((answer) => pending.push({ signal, answer }));

  for (const get of [rejecting, answeringLate]) {
    const { looks, invalidated, warnings } = harness(async () => ANSWER, {}, get);
    const renamed = looks.threadChanged({ id: "thr_pr", changes: ["title-changed"] });
    looks.dispose();
    const lookup = pending.at(-1);
    assert.ok(lookup);
    lookup.answer({ originPluginId: "regional-manager", parentThreadId: null });
    await renamed;
    assert.equal(lookup.signal.aborted, true, "the lookup was handed the signal that aborted");
    assert.deepEqual(invalidated, []);
    assert.deepEqual(warnings, []);
  }
});
