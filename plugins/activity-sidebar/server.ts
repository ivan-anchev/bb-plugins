// Composition root: the Sleep store, the archived counter and the events that refresh it, and the RPC
// methods over both. Owns no logic.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { activitySidebarContract } from "./src/contract.ts";
import { ARCHIVE_EVENTS, openArchivedCount } from "./src/server/archived-count.ts";
import { createRpcHandlers } from "./src/server/rpc-handlers.ts";
import { openSleepStore } from "./src/server/sleep-store.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openSleepStore(bb.storage);
  const archived = openArchivedCount({ threads: bb.sdk.threads, rpc: bb.rpc });
  for (const event of ARCHIVE_EVENTS) bb.events.on(event, ({ thread }) => archived.changed(thread));
  bb.rpc.register(activitySidebarContract, createRpcHandlers({ rpc: bb.rpc, store, archived }));
}
