// A row's menu as data, in Zeron's order and words (Z:screens/shell/sidebar.luau:1156-1270): Rename, Pin,
// Copy ▸, Sleep ▸ (or Wake), a rule, Archive (or Unarchive), Delete…. Every bb entry runs bb's own bound
// action, so bb's confirmations, Undo toast and errors stay; this only chooses which, in what order,
// under which name. Sleep is the list's own.
import type { PluginBoundThreadAction, PluginThreadActionEntry } from "@get-bb/plugin-sdk/app";
import type { RowModel } from "./activity.ts";
import { sleepPresets } from "./sleep.ts";

/** bb's own actions the menu uses, as bb 0.49 registers them (checked against its registrations). */
const CORE = {
  rename: "bb--core/rename",
  pin: "bb--core/pin",
  copyLink: "bb--core/copyLink",
  archive: "bb--core/archive",
  delete: "bb--core/delete",
} as const;

/** The keys to ask `experimental_useThreadActions` for. */
export const CORE_KEYS: readonly string[] = Object.values(CORE);

/** Zeron's reason a working thread can't be archived (Z:locales/en.json shell.sidebar.menu.archive_working). */
const STILL_WORKING = "Stop it first: its agent is still working";

/**
 * One item; `icon` null draws no glyph slot (Sleep's times). `why`, when set, says on a muted second
 * line why it is disabled.
 */
export type MenuAction = { kind: "action"; key: string; label: string; icon: string | null; danger: boolean; why: string | null; disabled: boolean; run(): void };
/** One of bb's own actions: each has its glyph. */
type BbAction = MenuAction & { icon: string };
type MenuRule = { kind: "rule"; key: string };
export type MenuEntry = MenuAction | { kind: "submenu"; key: string; label: string; icon: string; entries: readonly (MenuAction | MenuRule)[] } | MenuRule;

/** The menu, and what the row's corner offers under the pointer: Archive, or Unarchive on the shelf. */
export type RowMenu = { entries: readonly MenuEntry[]; hoverAction: BbAction | null };

/** What the menu does itself rather than through bb. */
type OwnActions = { copyId(): void; sleep(until: number): void; wake(): void; sleepCustom(): void };

/**
 * The row's menu from bb's bound actions, Sleep's times counted from `now`. An action bb doesn't offer
 * drops its entry. The menu's Archive is disabled while the agent works or waits on background work
 * (Zeron's rule, Z:screens/shell/sidebar.luau:1245); the corner's is not (Z:ds/sidebar.luau:1416-1420).
 */
export function rowMenu(row: RowModel, bound: readonly PluginThreadActionEntry[], own: OwnActions, now: number): RowMenu {
  const t = row.thread;
  const actions = new Map(bound.map((e) => [e.key, e.action]));
  const bb = (key: string, label: string, icon: string, why: string | null = null) => fromBb(key, actions.get(key), label, icon, why);

  const archive = (why: string | null) => (t.isArchived ? bb(CORE.archive, "Unarchive", "ArchiveRestore") : bb(CORE.archive, "Archive", "Archive", why));
  const copies = present([bb(CORE.copyLink, "bb thread link", "ArrowUpRight"), ownAction("copy:id", "Thread ID", "File", own.copyId)]);
  const entries = present<MenuEntry>([
    bb(CORE.rename, "Rename", "Edit"),
    // why: an archived thread can't hold a pin (prototype sessionMenu); Zeron's one glyph for both.
    t.isArchived ? null : bb(CORE.pin, t.isPinned ? "Unpin" : "Pin", "Pin"),
    { kind: "submenu", key: "copy", label: "Copy", icon: "Copy", entries: copies },
    sleepEntry(row, own, now),
    { kind: "rule", key: "rule" },
    archive(isBusy(row) ? STILL_WORKING : null),
    bb(CORE.delete, "Delete…", "Trash2"),
  ]);
  // why: with neither Archive nor Delete offered, the rule would end the menu.
  if (entries[entries.length - 1]?.kind === "rule") entries.pop();
  // why: Zeron's corner archives whatever the state; bb's action stops the agent, asking first only over subthreads.
  return { entries, hoverAction: archive(null) };
}

// ------------------------------------------------------------------ layer 2

/**
 * Asleep, Wake; otherwise Sleep ▸ with Zeron's times, each "{name} · {when}", then Custom…
 * (Z:screens/shell/sidebar.luau:1156-1191). A pin holds its row in place and Archived has left the
 * work, so neither offers Sleep.
 */
function sleepEntry(row: RowModel, own: OwnActions, now: number): MenuEntry | null {
  const t = row.thread;
  if (t.isPinned || t.isArchived) return null;
  if (row.asleepUntil !== null) return ownAction("wake", "Wake", "Sun", own.wake);
  const times = sleepPresets(new Date(now)).map((p) => ownAction(`sleep:${p.label}`, `${p.label} · ${p.when}`, null, () => own.sleep(p.until)));
  const entries = [...times, { kind: "rule", key: "sleep:rule" } as const, ownAction("sleep:custom", "Custom…", null, own.sleepCustom)];
  return { kind: "submenu", key: "sleep", label: "Sleep", icon: "Moon", entries };
}

/** Zeron's guard reads working or waiting only, not connecting (Z:screens/shell/sidebar.luau:1245). */
function isBusy(row: RowModel): boolean {
  return row.corner.kind === "state" && (row.corner.state === "working" || row.corner.state === "waiting");
}

function fromBb(key: string, action: PluginBoundThreadAction | undefined, label: string, icon: string, why: string | null): BbAction | null {
  if (action === undefined) return null;
  return {
    kind: "action",
    key,
    label,
    icon,
    danger: action.variant === "destructive",
    why,
    disabled: why !== null || action.disabled === true,
    run: () => void action.run(),
  };
}

function ownAction(key: string, label: string, icon: string | null, run: () => void): MenuAction {
  return { kind: "action", key, label, icon, danger: false, why: null, disabled: false, run };
}

function present<T>(entries: readonly (T | null)[]): T[] {
  return entries.filter((e): e is T => e !== null);
}
