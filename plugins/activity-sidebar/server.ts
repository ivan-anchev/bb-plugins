// Composition root: the Sleep store and its two RPC methods. Owns no logic.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { activitySidebarContract } from "./src/contract.ts";
import { createRpcHandlers } from "./src/server/rpc-handlers.ts";
import { openSleepStore } from "./src/server/sleep-store.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openSleepStore(bb.storage);
  bb.rpc.register(activitySidebarContract, createRpcHandlers({ rpc: bb.rpc, store }));
}
