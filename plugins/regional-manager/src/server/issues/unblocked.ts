// The one place an issue's unblocking is announced. After anything every issue's view is derived
// from changes (an issue written, an agent started or ended, a handoff, a pull request read, an
// agent thread's turn starting or ending), and on every tick, it reads every issue as viewed now and
// has the inbox record what that read says the last one didn't (relations.ts unblockedSince). So
// whatever closes an issue (a merge, a report, an agent ending on its report, a way not yet built)
// is announced with no hook of its own; a read that fails is simply read again on the next change
// or tick; and a read overtaken by a change is read again, never recorded (current-views.ts).
import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import type { CurrentViews } from "./current-views.ts";

type Deps = {
  bb: { log: Pick<PluginLogger, "warn">; onDispose(hook: () => void): void };
  store: Pick<Store, "coordinators" | "hasDependencies">;
  views: Pick<CurrentViews, "whileCurrent">;
  inbox: Pick<Inbox, "unblocked">;
};

export function watchUnblocked({ bb, store, views, inbox }: Deps) {
  /** The read running for each regional manager. why one at a time: a second would compare against closes the first is about to replace. */
  const running = new Map<CoordinatorId, Promise<void>>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /**
   * Records what was unblocked, on views no change overtook (current-views.ts): a stale read could
   * miss an open dependency added, or a research agent starting a new turn, while bb was read. Out
   * of reads, it records nothing. Nothing is read when nothing depends on anything.
   */
  async function settle(id: CoordinatorId): Promise<void> {
    try {
      if (disposed || !store.hasDependencies(id)) return;
      await views.whileCurrent(id, (current) => inbox.unblocked(id, current));
    } finally {
      // why here, as it returns: a change after this starts a read of its own.
      running.delete(id);
    }
  }

  /** The read running for the manager, which reads again for any change since it began while it has reads left, or a new one. */
  function settled(id: CoordinatorId): Promise<void> {
    const current = running.get(id);
    if (current !== undefined) return current;
    // why on the next microtask: a read can end without awaiting anything, and it must be running when it ends.
    const run = Promise.resolve().then(() => settle(id));
    running.set(id, run);
    return run;
  }

  return {
    /** Something the regional manager's views are derived from changed (current-views.ts changed first): reads them, or has the read running read them again. A failure, or a pass out of reads, waits for the next change or tick. */
    changed(id: CoordinatorId): void {
      settled(id).catch((error: unknown) => bb.log.warn(`Could not read what ${id}'s issues unblocked; the next tick tries again: ${messageOf(error)}`));
    },

    /** The tick's pass: reads every regional manager's issues, for a read that failed or a change the plugin missed, as across a reload. */
    async tick(): Promise<void> {
      for (const { id } of store.coordinators()) {
        if (disposed) return;
        await settled(id).catch((error: unknown) => bb.log.warn(`Could not read what ${id}'s issues unblocked; the next tick tries again: ${messageOf(error)}`));
      }
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
