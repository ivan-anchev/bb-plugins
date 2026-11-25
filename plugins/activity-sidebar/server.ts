// Composition root: the Sleep store, the archived counter, the managers' looks and the events that
// refresh them, and the RPC methods over all three. Owns no logic.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { activitySidebarContract } from "./src/contract.ts";
import { ARCHIVE_EVENTS, openArchivedCount } from "./src/server/archived-count.ts";
import { MANAGER_EVENTS, openManagerLooks } from "./src/server/manager-looks.ts";
import { createRpcHandlers } from "./src/server/rpc-handlers.ts";
import { openSleepStore } from "./src/server/sleep-store.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openSleepStore(bb.storage);
  const archived = openArchivedCount({ threads: bb.sdk.threads, rpc: bb.rpc });
  for (const event of ARCHIVE_EVENTS) bb.events.on(event, ({ thread }) => archived.changed(thread));

  const looks = openManagerLooks({ plugins: bb.sdk.plugins, rpc: bb.rpc, log: bb.log });
  for (const event of MANAGER_EVENTS) bb.events.on(event, ({ thread }) => looks.changed(thread));
  bb.onDispose(bb.sdk.subscribe({ event: "thread:changed", callback: looks.threadChanged }));
  bb.background.schedule("manager-looks", "* * * * *", looks.stale);

  bb.rpc.register(activitySidebarContract, createRpcHandlers({ rpc: bb.rpc, store, archived, looks }));
}
