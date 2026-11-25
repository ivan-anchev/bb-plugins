// RPC handlers: read every sleep; write one and refresh every client's read; read the archived count;
// read the managers' looks, lines and open work. A thin shell over the store, the counter, the looks,
// the lines and the open work.
import type { BbPluginApi, ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { activitySidebarContract, SLEEPS_TAG } from "../contract.ts";
import type { ArchivedCounter } from "./archived-count.ts";
import type { ManagerIssuesReader } from "./managers/manager-issues.ts";
import type { ManagerLines } from "./managers/manager-lines.ts";
import type { ManagerLooks } from "./managers/manager-looks.ts";
import type { SleepStore } from "./sleep-store.ts";

type Deps = {
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  store: SleepStore;
  archived: Pick<ArchivedCounter, "read">;
  looks: Pick<ManagerLooks, "read">;
  lines: Pick<ManagerLines, "read">;
  issues: Pick<ManagerIssuesReader, "read">;
};

export function createRpcHandlers({ rpc, store, archived, looks, lines, issues }: Deps): ExperimentalPluginRpcHandlersWithContext<typeof activitySidebarContract> {
  return {
    sleeps: () => ({ sleeps: store.all() }),
    setSleep: ({ threadId, until }) => {
      store.set(threadId, until);
      // why: writes don't declare what they change; marking the read stale moves the row on every client.
      rpc.experimental_invalidate([SLEEPS_TAG]);
      return {};
    },
    archivedCount: () => archived.read(),
    managerLooks: () => looks.read(),
    managerLines: (input) => lines.read(input),
    managerIssues: (input) => issues.read(input),
  };
}
