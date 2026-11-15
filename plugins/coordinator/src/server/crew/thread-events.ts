// Thread events are hints, not state: a crew thread's event only tells its coordinating thread's
// board to read again. The board derives everything on each read, so a missed event (a reload, a
// reconnect) costs nothing. Copied in spirit from pr-reviews' thread-events.ts.
import type { PluginThreadEventName } from "@get-bb/plugin-sdk";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store.ts";

const CREW_THREAD_EVENTS = [
  "thread.active",
  "thread.idle",
  "thread.failed",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "interaction.pending",
  // why: an approval or a question answered moves a crew out of Needs you without any status
  // change, and bb announces nothing else for it. bb sends this at most once a second per thread.
  "experimental_thread.events",
] as const satisfies readonly PluginThreadEventName[];

type ThreadEvent = { thread: { id: string; originPluginId: string | null } };

type EventsBb = {
  pluginId: string;
  events: { on(event: (typeof CREW_THREAD_EVENTS)[number], handler: (payload: ThreadEvent) => void): void };
};

export function forwardCrewThreadEvents(bb: EventsBb, store: Pick<Store, "roleOfThread">, refreshBoard: (id: CoordinatorId) => void): void {
  const refreshBoardOf = ({ thread }: ThreadEvent) => {
    if (thread.originPluginId !== bb.pluginId) return; // a cheap filter before touching SQLite
    const role = store.roleOfThread(thread.id);
    if (role?.kind === "crew") refreshBoard(role.coordinatorId);
  };
  for (const event of CREW_THREAD_EVENTS) bb.events.on(event, refreshBoardOf);
}
