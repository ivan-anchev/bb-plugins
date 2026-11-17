// The one place an issue's unblocking is announced. After anything every issue's view is derived
// from changes (an issue written, an agent started or ended, a handoff, a pull request read, an
// agent thread's turn starting or ending), and on every tick, it reads every issue as viewed now and
// has the inbox record what that read says the last one didn't (relations.ts unblockedSince). So
// whatever closes an issue (a merge, a report, an agent ending on its report, a way not yet built)
// is announced with no hook of its own; a read that fails is simply read again on the next change
// or tick; and a read overtaken by a change is read again, never recorded, a few times at most.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import { readIssues, type FactsBb, type FactsStore } from "./issue-facts.ts";

/**
 * How many reads one pass makes while changes keep overtaking them. why a bound: a manager whose
 * agents keep changing things must not hold the tick from every other manager and the doorbells;
 * the next change or tick reads again, and nothing is recorded or forgotten meanwhile.
 */
const READS_PER_PASS = 3;

type Deps = {
  bb: FactsBb & { log: Pick<PluginLogger, "warn">; onDispose(hook: () => void): void };
  store: FactsStore & Pick<Store, "coordinators" | "hasDependencies">;
  inbox: Pick<Inbox, "unblocked">;
};

export function watchUnblocked({ bb, store, inbox }: Deps) {
  /** How many changes each regional manager's views have seen: a read is current while this stays as it was when the read began. */
  const changes = new Map<CoordinatorId, number>();
  /** The read running for each regional manager. why one at a time: a second would compare against closes the first is about to replace. */
  const running = new Map<CoordinatorId, Promise<void>>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  const changesOf = (id: CoordinatorId): number => changes.get(id) ?? 0;

  /**
   * Reads every issue and records what was unblocked, reading again while a change came during the
   * read: its views may then be stale, as when an open dependency was added or a research agent
   * started a new turn while bb was read. After READS_PER_PASS reads overtaken it records nothing.
   * Nothing is read when nothing depends on anything.
   */
  async function settle(id: CoordinatorId): Promise<void> {
    try {
      for (let read = 0; read < READS_PER_PASS; read++) {
        if (disposed || !store.hasDependencies(id)) return;
        const before = changesOf(id);
        const views = (await readIssues(bb, store, id)).map(({ view }) => view);
        if (disposed) return;
        if (changesOf(id) !== before) continue;
        // why no await between the check and the record: no change can come in between.
        inbox.unblocked(id, views);
        return;
      }
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
    /** Something the regional manager's views are derived from changed: reads them, or has the read running read them again. A failure, or a pass out of reads, waits for the next change or tick. */
    changed(id: CoordinatorId): void {
      changes.set(id, changesOf(id) + 1);
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
