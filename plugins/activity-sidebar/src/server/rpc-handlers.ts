// RPC handlers: read every sleep; write one and refresh every client's read; read the archived count.
// A thin shell over the store and the counter.
import type { BbPluginApi, ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { activitySidebarContract, SLEEPS_TAG } from "../contract.ts";
import type { ArchivedCounter } from "./archived-count.ts";
import type { SleepStore } from "./sleep-store.ts";

type Deps = { rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">; store: SleepStore; archived: Pick<ArchivedCounter, "read"> };

export function createRpcHandlers({ rpc, store, archived }: Deps): ExperimentalPluginRpcHandlersWithContext<typeof activitySidebarContract> {
  return {
    sleeps: () => ({ sleeps: store.all() }),
    setSleep: ({ threadId, until }) => {
      store.set(threadId, until);
      // why: writes don't declare what they change; marking the read stale moves the row on every client.
      rpc.experimental_invalidate([SLEEPS_TAG]);
      return {};
    },
    archivedCount: () => archived.read(),
  };
}
