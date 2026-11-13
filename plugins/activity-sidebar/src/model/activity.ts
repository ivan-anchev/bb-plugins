// What the Activity sidebar shows, as data: every parent thread's row and the section it stands in.
// Pure: the live threads, the sleeps and the clock in; rows and sections out.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SleepRecord } from "../contract.ts";
import { hueOf, type Hue } from "./project-hue.ts";
import { stateOf, type ZState } from "./state.ts";
import { indexThreads } from "./thread-index.ts";
import { ago } from "./time.ts";

// why: issue 02 adds the Working, Asleep and Archived shelves; until then every unpinned parent is in Activity.
export type SectionKey = "pinned" | "activity";

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
};

/** Pinned first (bb's pin order), then Activity by rank, latest first. */
export function buildActivity(input: ActivityInput): readonly Section[] {
  const index = indexThreads(input.threads);
  const currentRoot = input.activeThreadId === null ? null : index.rootOf(input.activeThreadId);
  const projectNames = new Map(input.projects.map((p) => [p.id, p.name]));

  const parents = input.threads.filter(isListed);
  const pinned = parents.filter((t) => t.isPinned).sort(byPinOrder);
  const activity = parents
    .filter((t) => !t.isPinned)
    .map((t) => ({ thread: t, rank: rankOf(t, input.sleeps.get(t.id)) }))
    .sort((a, b) => b.rank - a.rank || compare(a.thread.id, b.thread.id))
    .map(({ thread }) => thread);

  const toRow = (thread: PluginSidebarThread): RowModel => {
    const state = stateOf(thread, input.sleeps.get(thread.id), input.now);
    const current = thread.id === input.activeThreadId || thread.id === currentRoot;
    const name = projectNames.get(thread.projectId) ?? "No project";
    return {
      thread,
      corner: state === null ? { kind: "time", text: ago(thread.latestAttentionAt, input.now) } : { kind: "state", state },
      strong: state !== null || current,
      current,
      runningUnder: index.runningUnder(thread.id),
      project: { name, hue: hueOf(thread.projectId) },
    };
  };

  return [
    { key: "pinned", rows: pinned.map(toRow) },
    { key: "activity", rows: activity.map(toRow) },
  ];
}

// ------------------------------------------------------------------ layer 2

/** Parents only; bb's hidden helpers and archived threads never get a row. */
function isListed(t: PluginSidebarThread): boolean {
  return t.parentThreadId === null && !t.isHidden && !t.isArchived;
}

/**
 * When it last came back: its own last move, or waking from sleep. bb's attention time is the move: it
 * advances when a turn ends or fails, never when the thread is read (`updatedAt` does both).
 */
function rankOf(t: PluginSidebarThread, sleep: SleepRecord | undefined): number {
  return Math.max(t.latestAttentionAt, sleep?.until ?? 0);
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
