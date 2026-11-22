import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { CoordinatorId } from "../../model/role.ts";
import { gitStatusOf, type GitStatusBb } from "../git-status.ts";
import type { Store } from "../store/store.ts";
import type { Inbox } from "./inbox.ts";

/** A thread as bb's thread.idle names it, down to the fields the watch reads. */
type ThreadRef = { id: string; originPluginId: string | null; environmentId: string | null };

/** The parts of bb the watch uses. */
type OwnTreeBb = GitStatusBb & {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  onDispose(hook: () => void): void;
  events: { on(event: "thread.idle", handler: (payload: { thread: ThreadRef }) => Promise<void>): void };
};

type Deps = { bb: OwnTreeBb; store: Pick<Store, "roleOfThread">; inbox: Pick<Inbox, "ownTreeRead"> };

export function watchOwnTree({ bb, store, inbox }: Deps): void {
  const disposal = new AbortController();
  bb.onDispose(() => disposal.abort());
  let reads = 0;
  const latestApplied = new Map<CoordinatorId, number>();

  bb.events.on("thread.idle", async ({ thread }) => {
    if (thread.originPluginId !== bb.pluginId || thread.environmentId === null) return;
    const role = store.roleOfThread(thread.id);
    if (role?.kind !== "coordinator") return;
    const read = ++reads;
    const fileCount = await changedFileCount(thread.environmentId);
    if (fileCount === null || disposal.signal.aborted || read < (latestApplied.get(role.coordinatorId) ?? 0)) return;
    latestApplied.set(role.coordinatorId, read);
    inbox.ownTreeRead(role.coordinatorId, fileCount);
  });

  async function changedFileCount(environmentId: string): Promise<number | null> {
    const status = await gitStatusOf(bb, environmentId, disposal.signal);
    if (disposal.signal.aborted) return null;
    switch (status.kind) {
      case "read":
        return status.changedFileCount;
      case "not-git":
        return null;
      case "unread":
        return unread(environmentId, status.reason);
      default:
        return status satisfies never;
    }
  }

  function unread(environmentId: string, why: string): null {
    bb.log.warn(`Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: ${why}`);
    return null;
  }
}
