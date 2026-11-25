import assert from "node:assert/strict";
import { test } from "node:test";
import { MANAGER_ISSUES_TAG } from "../../contract.ts";
import { MALFORMED_OPEN_ISSUES, OPEN_ISSUES } from "../../model/fixtures.ts";
import { openManagerIssues } from "./manager-issues.ts";

type RpcCall = (args: { signal?: AbortSignal }) => Promise<unknown>;

// bb's callRpc stands in as the plugin's answer (or its failure), parsed with the caller's outputSchema
// as bb does; bb's threads as a map, `get` answering 404 for one it doesn't hold.
function harness(answer: RpcCall, held: Record<string, { originPluginId: string | null }> = {}) {
  const calls: unknown[] = [];
  const invalidated: string[] = [];
  const warnings: string[] = [];
  const issues = openManagerIssues({
    plugins: {
      callRpc: async ({ outputSchema, signal, ...call }) => {
        calls.push(call);
        return outputSchema.parse(await answer({ signal }));
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
  return { issues, calls, invalidated, warnings };
}

test("reads each manager's open work from the Regional Manager plugin's openIssues, by the manager's id", async () => {
  const { issues, calls, warnings } = harness(async () => OPEN_ISSUES);
  assert.deepEqual(await issues.read({ keys: ["mgr_1"] }), OPEN_ISSUES);
  assert.deepEqual(calls, [{ pluginId: "regional-manager", method: "openIssues", input: { keys: ["mgr_1"] } }]);
  assert.deepEqual(warnings, []);
});

test("a manager the plugin answers nothing for has no open work to show", async () => {
  const { issues } = harness(async () => OPEN_ISSUES);
  assert.deepEqual(await issues.read({ keys: ["mgr_1", "mgr_9"] }), { ...OPEN_ISSUES, mgr_9: null });
});

test("a failed read (the plugin missing, or older than openIssues) leaves every card without its list, and warns", async () => {
  const { issues, warnings } = harness(async () => {
    throw new Error("HTTP 404: regional-manager has no method openIssues");
  });
  assert.deepEqual(await issues.read({ keys: ["mgr_1", "mgr_2"] }), { mgr_1: null, mgr_2: null });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Couldn't read the regional managers' open work; their cards show none: HTTP 404/);
});

test("an answer in a shape this copy of the schema doesn't know leaves every card without its list, and warns", async () => {
  for (const answer of MALFORMED_OPEN_ISSUES) {
    const { issues, warnings } = harness(async () => answer);
    assert.deepEqual(await issues.read({ keys: ["mgr_1"] }), { mgr_1: null }, JSON.stringify(answer));
    assert.equal(warnings.length, 1, JSON.stringify(answer));
  }
});

test("disposed while the plugin is being read: nothing is logged", async () => {
  let release = () => {};
  const { issues, warnings } = harness(
    ({ signal }) =>
      new Promise((_, reject) => {
        release = () => reject(signal?.reason ?? new Error("aborted"));
      }),
  );
  const read = issues.read({ keys: ["mgr_1"] });
  issues.dispose();
  release();
  assert.deepEqual(await read, { mgr_1: null });
  assert.deepEqual(warnings, []);
});

test("a thread of the Regional Manager plugin's moving, and the minute's timer, make every card read again; another plugin's thread doesn't", () => {
  const { issues, invalidated } = harness(async () => OPEN_ISSUES);
  issues.changed({ originPluginId: "regional-manager" });
  issues.changed({ originPluginId: null });
  issues.changed({ originPluginId: "boat-sandbox" });
  issues.stale();
  assert.deepEqual(invalidated, [MANAGER_ISSUES_TAG, MANAGER_ISSUES_TAG]);
});

test("a thread whose questions changed is read from bb: a Regional Manager one makes every card read again; one bb can't read warns and waits for the minute", async () => {
  const { issues, invalidated, warnings } = harness(async () => OPEN_ISSUES, { thr_agent: { originPluginId: "regional-manager" }, thr_other: { originPluginId: null } });
  await issues.threadChanged({ id: "thr_other", changes: ["interactions-changed"] });
  await issues.threadChanged({ id: "thr_agent", changes: ["status-changed", "events-appended"] });
  assert.deepEqual(invalidated, []);
  await issues.threadChanged({ id: "thr_agent", changes: ["interactions-changed"] });
  assert.deepEqual(invalidated, [MANAGER_ISSUES_TAG]);
  await issues.threadChanged({ id: "thr_gone", changes: ["interactions-changed"] });
  assert.deepEqual(invalidated, [MANAGER_ISSUES_TAG]);
  assert.match(warnings[0] ?? "", /Couldn't read thread thr_gone, whose questions changed; the cards read again within a minute: HTTP 404/);
});
