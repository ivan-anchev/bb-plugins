import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Inbox } from "../../inbox/inbox.ts";
import type { Store } from "../../store/store.ts";
import type { CurrentViews } from "./current-views.ts";

type Deps = {
  bb: { log: Pick<PluginLogger, "warn">; onDispose(hook: () => void): void };
  store: Pick<Store, "coordinators" | "hasDependencies">;
  views: Pick<CurrentViews, "whileCurrent">;
  inbox: Pick<Inbox, "unblocked">;
};

export function watchUnblocked({ bb, store, views, inbox }: Deps) {
  const running = new Map<CoordinatorId, Promise<void>>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  async function settle(id: CoordinatorId): Promise<void> {
    try {
      if (disposed || !store.hasDependencies(id)) return;
      await views.whileCurrent(id, (current) => inbox.unblocked(id, current));
    } finally {
      running.delete(id);
    }
  }

  function settled(id: CoordinatorId): Promise<void> {
    const current = running.get(id);
    if (current !== undefined) return current;
    const run = Promise.resolve().then(() => settle(id));
    running.set(id, run);
    return run;
  }

  return {
    changed(id: CoordinatorId): void {
      settled(id).catch((error: unknown) => bb.log.warn(`Could not read what ${id}'s issues unblocked; the next tick tries again: ${messageOf(error)}`));
    },

    async tick(): Promise<void> {
      for (const { id } of store.coordinators()) {
        if (disposed) return;
        await settled(id).catch((error: unknown) => bb.log.warn(`Could not read what ${id}'s issues unblocked; the next tick tries again: ${messageOf(error)}`));
      }
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
