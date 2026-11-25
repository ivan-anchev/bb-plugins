// Which bb events make the managers' cards read their open work again, as server.ts wires them: the
// plugin loaded on the SDK's fake host, its events delivered, its invalidations recorded.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { MANAGER_ISSUES_TAG } from "../contract.ts";

type ThreadChange = { id?: string; changes: readonly string[] };

function loaded(threads: Record<string, { originPluginId: string | null }>) {
  const { bb, harness } = createFakePluginHost({ pluginId: "activity-sidebar" });
  const invalidated: string[] = [];
  const realtime: ((change: ThreadChange) => void)[] = [];
  const rpc: BbPluginApi["rpc"] = { ...bb.rpc, experimental_invalidate: (tags) => void invalidated.push(...tags) };
  harness.sdk.stub("subscribe", ({ callback }: { callback: (change: ThreadChange) => void }) => {
    realtime.push(callback);
    return () => {};
  });
  harness.sdk.stub("threads.get", async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, ...threads[threadId] }));
  plugin({ ...bb, rpc });
  const issuesRead = () => invalidated.filter((tag) => tag === MANAGER_ISSUES_TAG).length;
  return { harness, realtime, issuesRead };
}

const MANAGERS = { thr_agent: { originPluginId: "regional-manager" }, thr_other: { originPluginId: null } };

test("a Regional Manager thread coming back from the archive makes the cards read again; another plugin's doesn't", async () => {
  const { harness, issuesRead } = loaded(MANAGERS);
  await harness.emitThreadEvent("thread.unarchived", { thread: makeThreadResponse({ id: "thr_other", originPluginId: null }) });
  assert.equal(issuesRead(), 0);
  await harness.emitThreadEvent("thread.unarchived", { thread: makeThreadResponse({ id: "thr_agent", originPluginId: "regional-manager" }) });
  assert.equal(issuesRead(), 1);
});

test("an agent's question or approval answered, its status unchanged, makes the cards read again; another plugin's thread, or another change, doesn't", async () => {
  const { realtime, issuesRead } = loaded(MANAGERS);
  const tell = async (change: ThreadChange) => {
    for (const callback of realtime) callback(change);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await tell({ id: "thr_other", changes: ["interactions-changed"] });
  await tell({ id: "thr_agent", changes: ["events-appended"] });
  assert.equal(issuesRead(), 0);
  await tell({ id: "thr_agent", changes: ["interactions-changed"] });
  assert.equal(issuesRead(), 1);
});
