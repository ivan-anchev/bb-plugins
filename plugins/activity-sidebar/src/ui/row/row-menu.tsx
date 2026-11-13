// A row's right-click menu (Zeron has no ⋯ on rows): the entries from src/model/row-menu.ts drawn in
// Zeron's menu metrics with bb's surfaces. bb's host shims Radix, so the menu shares its overlay layer.
import {
  experimental_copyToClipboard as copyToClipboard,
  experimental_Icon as Icon,
  experimental_useThreadActions as useThreadActions,
  type PluginSidebarThread,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { Content, Item, Portal, Separator, Sub, SubContent, SubTrigger } from "@radix-ui/react-context-menu";
import { toast } from "sonner";
import type { RowModel } from "../../model/activity.ts";
import { CORE_KEYS, rowMenu, type MenuAction, type MenuEntry, type RowMenu } from "../../model/row-menu.ts";
import { PORTAL_SCOPE } from "../portal-scope.ts";

/** The row's menu from bb's own bound actions; Rename opens the row's own editor. */
export function useRowMenu(row: RowModel, requestRename: (threadId: string) => void): RowMenu {
  const bound = useThreadActions(toActionTarget(row.thread), { keys: CORE_KEYS, requestRename });
  return rowMenu(row, bound, { copyId: () => void copyThreadId(row.thread.id) });
}

/** The open menu. `onCloseAutoFocus` lets the row take focus for its editor instead of the trigger. */
export function RowMenuContent({ entries, onCloseAutoFocus }: { entries: readonly MenuEntry[]; onCloseAutoFocus(event: Event): void }) {
  return (
    <Portal>
      <Content {...PORTAL_SCOPE} className="as-menu as-row-menu border" collisionPadding={8} onCloseAutoFocus={onCloseAutoFocus}>
        {entries.map(renderEntry)}
      </Content>
    </Portal>
  );
}

// ------------------------------------------------------------------ layer 2

function renderEntry(entry: MenuEntry) {
  switch (entry.kind) {
    case "rule":
      return <Separator key={entry.key} className="as-menu-separator" />;
    case "submenu":
      return (
        <Sub key={entry.key}>
          <SubTrigger className="as-menu-item as-action">
            <Glyph icon={entry.icon} />
            <span className="as-menu-label">{entry.label}</span>
            <Icon name="ChevronRight" className="as-action-chevron" aria-hidden />
          </SubTrigger>
          <Portal>
            <SubContent {...PORTAL_SCOPE} className="as-menu as-row-menu border" sideOffset={4} alignOffset={-5} collisionPadding={8}>
              {entry.entries.map(renderEntry)}
            </SubContent>
          </Portal>
        </Sub>
      );
    case "action":
      return <ActionItem key={entry.key} action={entry} />;
    default:
      entry satisfies never;
      return null;
  }
}

/** A disabled item says why on a muted second line under its label (Zeron's ds/menu). */
function ActionItem({ action }: { action: MenuAction }) {
  return (
    <Item className="as-menu-item as-action" disabled={action.disabled} data-danger={action.danger || undefined} onSelect={action.run}>
      <Glyph icon={action.icon} />
      <span className="as-action-words">
        <span className="as-menu-label">{action.label}</span>
        {action.disabled && action.why !== null && <span className="as-action-why">{action.why}</span>}
      </span>
    </Item>
  );
}

/** Zeron's glyph: 16 in an 18 box. */
function Glyph({ icon }: { icon: string }) {
  return (
    <span className="as-action-glyph" aria-hidden>
      <Icon name={icon} />
    </span>
  );
}

/** Through bb's own clipboard writer, worded as bb's "Thread link copied". */
async function copyThreadId(id: string) {
  if (await copyToClipboard({ text: id })) toast.success("Thread ID copied");
  else toast.error("Failed to copy thread ID");
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
