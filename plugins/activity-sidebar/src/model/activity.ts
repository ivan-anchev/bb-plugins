// What the Activity sidebar shows, as data: every parent thread's row and the section it stands in.
// Pure: the live threads, the sleeps and the clock in; rows and sections out.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SleepRecord } from "../contract.ts";
import { hueOf, type Hue } from "./project-hue.ts";
import { stateOf, UNDER_WAY, type ZState } from "./state.ts";
import { indexThreads } from "./thread-index.ts";
import { ago } from "./time.ts";

export type SectionKey = "pinned" | "activity" | "working" | "asleep" | "archived";

/** Every section, top to bottom; the last three are the shelves at the foot. */
export const SECTION_KEYS: readonly SectionKey[] = ["pinned", "activity", "working", "asleep", "archived"];

/** The row's trailing box: its state's glyph ELSE its time, never both. */
export type Corner = { kind: "state"; state: ZState } | { kind: "time"; text: string };

export type RowModel = {
  thread: PluginSidebarThread;
  corner: Corner;
  /** A state, or the open thread: primary ink, medium weight. */
  strong: boolean;
  /** The open thread, or the parent of the open subthread. */
  current: boolean;
  runningUnder: number;
  project: { name: string; hue: Hue };
};

export type Section = { key: SectionKey; rows: readonly RowModel[] };

export type ActivityInput = {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  sleeps: ReadonlyMap<string, SleepRecord>;
  now: number;
  activeThreadId: string | null;
  /** The project every section is narrowed to, or null for every project. */
  filter: string | null;
};

/**
 * Every section in SECTION_KEYS order, each holding its rows top to bottom: Pinned in bb's pin order,
 * Asleep soonest to wake first, the rest latest first.
 */
export function buildActivity(input: ActivityInput): readonly Section[] {
  const index = indexThreads(input.threads);
  const currentRoot = input.activeThreadId === null ? null : index.rootOf(input.activeThreadId);
  const projectNames = new Map(input.projects.map((p) => [p.id, p.name]));

  const placed = input.threads
    .filter((t) => isListed(t) && (input.filter === null || t.projectId === input.filter))
    .map((thread) => {
      const sleep = input.sleeps.get(thread.id);
      // why: an archived thread has left the work; its row says when it left, not what it last did.
      const state = thread.isArchived ? null : stateOf(thread, sleep, input.now);
      return { thread, sleep, state, section: sectionOf(thread, sleep, state, input.now) };
    });

  const toRow = ({ thread, state }: (typeof placed)[number]): RowModel => {
    const current = thread.id === input.activeThreadId || thread.id === currentRoot;
    const name = projectNames.get(thread.projectId) ?? "No project";
    return {
      thread,
      corner: state === null ? { kind: "time", text: ago(lastMoved(thread), input.now) } : { kind: "state", state },
      strong: state !== null || current,
      current,
      runningUnder: index.runningUnder(thread.id),
      project: { name, hue: hueOf(thread.projectId) },
    };
  };

  return SECTION_KEYS.map((key) => {
    const members = placed.filter((p) => p.section === key);
    const ordered =
      key === "pinned"
        ? members.sort((a, b) => byPinOrder(a.thread, b.thread))
        : members.sort((a, b) => rankOf(b.thread, b.sleep, key) - rankOf(a.thread, a.sleep, key) || compare(a.thread.id, b.thread.id));
    return { key, rows: ordered.map(toRow) };
  });
}

// ------------------------------------------------------------------ layer 2

/** Parents only; bb's hidden helpers never get a row. */
function isListed(t: PluginSidebarThread): boolean {
  return t.parentThreadId === null && !t.isHidden;
}

/**
 * Archived first, then Pinned (a pin holds its row in place whatever it does), then Asleep until its
 * time, then Working while under way (Zeron: screens/shell/activity.luau:48-59); the rest is Activity.
 */
function sectionOf(t: PluginSidebarThread, sleep: SleepRecord | undefined, state: ZState | null, now: number): SectionKey {
  if (t.isArchived) return "archived";
  if (t.isPinned) return "pinned";
  if (sleep !== undefined && sleep.until > now) return "asleep";
  if (state !== null && UNDER_WAY.has(state)) return "working";
  return "activity";
}

/**
 * Higher stands nearer the top. Asleep: the soonest to wake. Archived: the latest archived. The rest:
 * when it last came back, its own last move or waking from sleep (Zeron: activity.luau:63-68). bb's
 * attention time is the move: it advances when a turn ends or fails, never when the thread is read
 * (`updatedAt` does both).
 */
function rankOf(t: PluginSidebarThread, sleep: SleepRecord | undefined, section: SectionKey): number {
  if (section === "asleep") return -(sleep?.until ?? 0);
  if (section === "archived") return lastMoved(t);
  return Math.max(t.latestAttentionAt, sleep?.until ?? 0);
}

/** When the row last moved, as its corner says: archived, when it was archived; else when it came back. */
function lastMoved(t: PluginSidebarThread): number {
  return t.isArchived ? (t.archivedAt ?? t.updatedAt) : t.latestAttentionAt;
}

/**
 * bb's own pin order (its bundled thread list): two manual keys by key ascending; otherwise the
 * latest pin first, then the newest thread, then by id.
 */
function byPinOrder(a: PluginSidebarThread, b: PluginSidebarThread): number {
  if (a.pinSortKey !== null && b.pinSortKey !== null) {
    const byKey = compare(a.pinSortKey, b.pinSortKey);
    if (byKey !== 0) return byKey;
  }
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || b.createdAt - a.createdAt || compare(a.id, b.id);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
