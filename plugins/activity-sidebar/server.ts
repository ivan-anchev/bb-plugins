// Composition root: the Sleep store, the archived counter, the managers' looks, lines and open work and
// the events that refresh them, and the RPC methods over all five. Owns no logic.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { activitySidebarContract } from "./src/contract.ts";
import { ARCHIVE_EVENTS, openArchivedCount } from "./src/server/archived-count.ts";
import { ISSUE_EVENTS, openManagerIssues } from "./src/server/managers/manager-issues.ts";
import { openManagerLines } from "./src/server/managers/manager-lines.ts";
import { MANAGER_EVENTS, openManagerLooks } from "./src/server/managers/manager-looks.ts";
import { createRpcHandlers } from "./src/server/rpc-handlers.ts";
import { openSleepStore } from "./src/server/sleep-store.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openSleepStore(bb.storage);
  const archived = openArchivedCount({ threads: bb.sdk.threads, rpc: bb.rpc });
  for (const event of ARCHIVE_EVENTS) bb.events.on(event, ({ thread }) => archived.changed(thread));

  const looks = openManagerLooks({ plugins: bb.sdk.plugins, threads: bb.sdk.threads, rpc: bb.rpc, log: bb.log });
  bb.events.on("thread.created", ({ thread }) => looks.created(thread));
  for (const event of MANAGER_EVENTS) bb.events.on(event, ({ thread }) => looks.changed(thread));
  bb.onDispose(bb.sdk.subscribe({ event: "thread:changed", callback: (change) => void looks.threadChanged(change) }));
  bb.onDispose(looks.dispose);
  bb.background.schedule("manager-looks", "* * * * *", looks.stale);

  const lines = openManagerLines({ threads: bb.sdk.threads, rpc: bb.rpc, log: bb.log });
  bb.events.on("experimental_thread.events", ({ thread }) => lines.moved(thread));
  bb.onDispose(bb.sdk.subscribe({ event: "thread:changed", callback: lines.changed }));
  bb.onDispose(lines.dispose);

  const issues = openManagerIssues({ plugins: bb.sdk.plugins, threads: bb.sdk.threads, rpc: bb.rpc, log: bb.log });
  for (const event of ISSUE_EVENTS) bb.events.on(event, ({ thread }) => issues.changed(thread));
  bb.onDispose(bb.sdk.subscribe({ event: "thread:changed", callback: (change) => void issues.threadChanged(change) }));
  bb.onDispose(issues.dispose);
  bb.background.schedule("manager-issues", "* * * * *", issues.stale);

  bb.rpc.register(activitySidebarContract, createRpcHandlers({ rpc: bb.rpc, store, archived, looks, lines, issues }));
}
