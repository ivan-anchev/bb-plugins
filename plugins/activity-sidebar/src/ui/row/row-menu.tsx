// A row's right-click menu is bb's own thread menu, with Sleep (or Wake) added. Under the pointer, the
// row's corner offers bb's Archive (Unarchive on the shelf).
import {
  experimental_useThreadActions as useThreadActions,
  type PluginBoundThreadAction,
  type PluginSidebarThread,
  type PluginThreadActionsInlineItem,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { useMinute } from "../../data/use-minute.ts";
import type { RowModel } from "../../model/activity.ts";
import { sleepItem } from "../../model/sleep-action.ts";

/** What a row's Sleep and Wake do: the list owns the sleeps. */
export type RowSleep = { sleep(threadId: string, until: number): void; wake(threadId: string): void };

/** bb's Archive, which also unarchives an archived thread. */
const ARCHIVE = "bb--core/archive";

/** What bb's menu needs from the row, and the corner's action. */
export type RowActions = {
  target: PluginThreadActionTarget;
  inline: readonly PluginThreadActionsInlineItem[];
  corner: PluginBoundThreadAction | null;
};

/** The row's Sleep counted from the present minute; `sleepCustom` opens the row's own dialog. */
export function useRowActions(row: RowModel, sleep: RowSleep, sleepCustom: () => void): RowActions {
  const id = row.thread.id;
  const target = toActionTarget(row.thread);
  const corner = useThreadActions(target, { keys: [ARCHIVE] })[0]?.action ?? null;
  const now = useMinute();
  const item = sleepItem(row, { sleep: (until) => sleep.sleep(id, until), wake: () => sleep.wake(id), sleepCustom }, now);
  return { target, inline: item === null ? [] : [item], corner };
}

/** The fields bb's own actions read, copied from the sidebar row as bb's own list does. */
function toActionTarget(t: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: t.id,
    projectId: t.projectId,
    parentThreadId: t.parentThreadId,
    parentNotifications: t.parentNotifications,
    archivedAt: t.archivedAt,
    pinnedAt: t.pinnedAt,
    sectionId: t.sectionId,
    isUnread: t.isUnread,
    status: t.status,
    environment: t.environment?.id == null ? null : { id: t.environment.id, path: t.environment.path },
  };
}
