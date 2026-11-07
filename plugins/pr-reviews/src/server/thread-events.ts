// Thread events are hints, not state: they only tell the app which reads to refetch. State
// is derived again on every read, so a missed event (a reload, a reconnect) costs nothing.
import type { BbPluginApi, PluginThreadEventName } from "@get-bb/plugin-sdk";
import { repoTag } from "../contract.ts";
import type { Store } from "./store.ts";

const STATUS_EVENTS = [
  "thread.active",
  "thread.idle",
  "thread.failed",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
] as const satisfies readonly PluginThreadEventName[];

type ThreadEvent = { thread: { id: string; originPluginId: string | null } };

export function forwardReviewThreadEvents(bb: BbPluginApi, store: Store): void {
  const refreshReviewOf = ({ thread }: ThreadEvent) => {
    if (thread.originPluginId !== bb.pluginId) return; // a cheap filter before touching SQLite
    const run = store.latestRunForThread(thread.id);
    if (run !== null) bb.rpc.experimental_invalidate([repoTag(run.key.repo)]);
  };
  for (const event of STATUS_EVENTS) bb.events.on(event, refreshReviewOf);
}
