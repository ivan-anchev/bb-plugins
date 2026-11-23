// The one place what every issue's view says is observed: what it unblocked, and each status an
// issue moved to. After anything every issue's view is derived from changes (an issue written, an
// agent started or ended, a handoff, a pull request read, an agent thread's turn starting or
// ending), and on every tick, it reads every issue as viewed now, and in one act has the inbox record
// what that read says was unblocked since the last (relations.ts unblockedSince) and the store log
// each status that isn't the last one logged (log-store.ts observeStatuses). So whatever closes an
// issue or moves it (a merge, a report, a verdict, an agent ending, a way not yet built) is observed
// with no hook of its own, and nothing replays the status rule over past facts; a read that fails is
// simply read again on the next change or tick; and a read overtaken by a change is read again,
// never recorded (current-views.ts).
import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Inbox } from "../../inbox/inbox.ts";
import type { Store } from "../../store/store.ts";
import type { CurrentViews } from "./current-views.ts";

type Deps = {
  bb: { log: Pick<PluginLogger, "warn">; onDispose(hook: () => void): void };
  store: Pick<Store, "coordinators" | "observeStatuses">;
  views: Pick<CurrentViews, "whileCurrent">;
  inbox: Pick<Inbox, "unblocked">;
  /** Tells the regional manager's open issue tabs whose issues were written (issue-tags.ts). */
  publish(id: CoordinatorId): void;
  now(): number;
};

export function watchViews({ bb, store, views, inbox, publish, now }: Deps) {
  /** The read running for each regional manager. why one at a time: a second would compare against what the first is about to record. */
  const running = new Map<CoordinatorId, Promise<void>>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /** What the views say, recorded in one act: no change can come between the unblocked and the statuses. */
  function observe(id: CoordinatorId, current: readonly IssueView[]): number {
    inbox.unblocked(id, current);
    return store.observeStatuses(id, current, now());
  }

  /**
   * Records what the views say, on views no change overtook (current-views.ts): a stale read could
   * miss an open dependency added, or a status moved, while bb was read. Out of reads, it records
   * nothing. Then tells the open tabs of an issue whose status it logged.
   */
  async function settle(id: CoordinatorId): Promise<void> {
    try {
      if (disposed) return;
      const observed = await views.whileCurrent(id, (current) => observe(id, current));
      if (observed !== null && observed.acted > 0) publish(id);
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
    /** Something the regional manager's views are derived from changed (the store counted its write as it committed, or current-views.ts was told first of what bb moved): reads them, or has the read running read them again. A failure, or a pass out of reads, waits for the next change or tick. */
    changed(id: CoordinatorId): void {
      settled(id).catch((error: unknown) => bb.log.warn(`Could not read what ${id}'s issues say now; the next tick tries again: ${messageOf(error)}`));
    },

    /** The tick's pass: reads every regional manager's issues, for a read that failed or a change the plugin missed, as across a reload. */
    async tick(): Promise<void> {
      for (const { id } of store.coordinators()) {
        if (disposed) return;
        await settled(id).catch((error: unknown) => bb.log.warn(`Could not read what ${id}'s issues say now; the next tick tries again: ${messageOf(error)}`));
      }
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
