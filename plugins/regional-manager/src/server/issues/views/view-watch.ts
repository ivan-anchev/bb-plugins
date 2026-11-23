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
import { settlesWithin } from "../../settles-within.ts";
import type { Store } from "../../store/store.ts";
import type { CurrentViews } from "./current-views.ts";

/**
 * How long the tick waits for the reads it starts. why a bound: a read bb never answers holds only
 * its own regional manager, as an issue's turn does (issue-turns.ts); the tick goes on to publish
 * and ring, and the read records what it saw whenever it ends.
 */
const TICK_WAIT_MS = 20_000;

type Deps = {
  bb: { log: Pick<PluginLogger, "warn">; onDispose(hook: () => void): void };
  store: Pick<Store, "coordinators" | "observeStatuses">;
  views: Pick<CurrentViews, "whileCurrent">;
  inbox: Pick<Inbox, "unblocked">;
  /** Tells the regional manager's open issue tabs whose issues were written (issue-tags.ts). */
  publish(id: CoordinatorId): void;
  now(): number;
};

/** `tickWaitMs`: how long the tick waits for its reads; tests shorten it. */
export function watchViews({ bb, store, views, inbox, publish, now }: Deps, tickWaitMs = TICK_WAIT_MS) {
  /** The read running for each regional manager. why one at a time: a second would compare against what the first is about to record. */
  const running = new Map<CoordinatorId, Promise<void>>();
  /** How many changes each regional manager was told of: a pass covers those told before it acts, as one told during its read overtakes it (whileCurrent reads again). */
  const told = new Map<CoordinatorId, number>();
  /** Reads a tick waited for in vain. why kept: a later tick waits for none of them again, so a read bb never answers gathers no more waiters. */
  const outwaited = new WeakSet<Promise<void>>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  const toldOf = (id: CoordinatorId): number => told.get(id) ?? 0;

  /** What the views say, recorded in one act: no change can come between the unblocked and the statuses. */
  function observe(id: CoordinatorId, current: readonly IssueView[]): number {
    inbox.unblocked(id, current);
    return store.observeStatuses(id, current, now());
  }

  /**
   * Records what the views say, on views no change overtook (current-views.ts): a stale read could
   * miss an open dependency added, or a status moved, while bb was read. Then tells the open tabs of
   * an issue whose status it logged, and reads again for a change told as it acted or since, as one
   * told while the pass returned. Out of reads, or failed, it records nothing and waits for the next
   * change or tick.
   */
  async function settle(id: CoordinatorId): Promise<void> {
    try {
      for (;;) {
        if (disposed) return;
        let covered = 0;
        const observed = await views.whileCurrent(id, (current) => {
          covered = toldOf(id);
          return observe(id, current);
        });
        if (observed === null) return;
        if (observed.acted > 0) publish(id);
        if (toldOf(id) === covered) return;
      }
    } catch (error: unknown) {
      // why here, once for the read: every change and tick waiting for it shares this one handler.
      bb.log.warn(`Could not read what ${id}'s issues say now; the next change or tick tries again: ${messageOf(error)}`);
    } finally {
      running.delete(id);
    }
  }

  /** The read running for the manager, or a new one. */
  function settled(id: CoordinatorId): Promise<void> {
    const current = running.get(id);
    if (current !== undefined) return current;
    // why on the next microtask: a read can end without awaiting anything, and it must be running when it ends.
    const run = Promise.resolve().then(() => settle(id));
    running.set(id, run);
    return run;
  }

  return {
    /** Something the regional manager's views are derived from changed (the store counted a write as a call through it returned, told-writes.ts, or bb moved one of its threads): reads them, or has the read running read them again once it is done. */
    changed(id: CoordinatorId): void {
      told.set(id, toldOf(id) + 1);
      void settled(id);
    },

    /**
     * The tick's pass: reads every regional manager's issues, for a read that failed or a change the
     * plugin missed, as across a reload. why side by side, and waited for only so long: one manager's
     * read bb is slow to answer must hold no other's, nor the rest of the tick.
     */
    async tick(): Promise<void> {
      const reads = store
        .coordinators()
        .map(({ id }) => settled(id))
        .filter((read) => !outwaited.has(read));
      if (await settlesWithin(Promise.all(reads), tickWaitMs)) return;
      for (const read of reads) outwaited.add(read);
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
