// What the Activity sidebar shows, as data: every parent thread's row and the section it stands in.
// Pure: the live threads, the sleeps and the clock in; rows and sections out.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SleepRecord } from "../contract.ts";
import { hueOf, type Hue } from "./project-hue.ts";
import { wakesIn } from "./sleep.ts";
import { NEEDS_YOU, stateOf, UNDER_WAY, type ZState } from "./state.ts";
import { indexThreads, type ThreadIndex } from "./thread-index.ts";
import { ago } from "./time.ts";

export type SectionKey = "pinned" | "activity" | "working" | "asleep" | "archived";

/** Every section, top to bottom; the last three are the shelves at the foot. */
export const SECTION_KEYS: readonly SectionKey[] = ["pinned", "activity", "working", "asleep", "archived"];

/** The row's trailing box: its state's glyph ELSE its time (on Asleep, how soon it wakes), never both. */
export type Corner = { kind: "state"; state: ZState } | { kind: "time"; text: string } | { kind: "wakes"; text: string };

export type RowModel = {
  thread: PluginSidebarThread;
  corner: Corner;
  /** A state, or the open thread: primary ink, medium weight. */
  strong: boolean;
  /** The open thread, or the parent of the open subthread. */
  current: boolean;
  runningUnder: number;
  project: { name: string; hue: Hue };
  /** The regular row's second line (Zeron's `SessionRow.detail`, less the project the row's mark already shows). */
  detail: RowDetail;
  /** When it wakes, while it sleeps on the Asleep shelf; null otherwise. */
  asleepUntil: number | null;
};

/** The machine it runs on and its branch, each null when bb names none. */
export type RowDetail = { machine: string | null; branch: string | null };

export type Section = { key: SectionKey; rows: readonly RowModel[] };

/** The sections, and the index of who hangs under whom they were built from (the hover card's tree). */
export type ActivityModel = { sections: readonly Section[]; index: ThreadIndex };

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
export function buildActivity(input: ActivityInput): ActivityModel {
  const index = indexThreads(input.threads);
  const currentRoot = input.activeThreadId === null ? null : index.rootOf(input.activeThreadId);
  const projectNames = new Map(input.projects.map((p) => [p.id, p.name]));

  const placed = input.threads
    .filter((t) => isListed(t) && (input.filter === null || t.projectId === input.filter))
    .map((thread) => {
      const sleep = sleepOf(thread, input.sleeps);
      // why: an archived thread has left the work; its row says when it left, not what it last did.
      const state = thread.isArchived ? null : stateOf(thread, sleep, input.now);
      return { thread, sleep, state, section: sectionOf(thread, sleep, state, input.now) };
    });

  const toRow = ({ thread, sleep, state, section }: (typeof placed)[number]): RowModel => {
    const current = thread.id === input.activeThreadId || thread.id === currentRoot;
    const name = projectNames.get(thread.projectId) ?? "No project";
    const asleepUntil = section === "asleep" && sleep !== undefined ? sleep.until : null;
    return {
      thread,
      corner: cornerOf(thread, state, asleepUntil, input.now),
      strong: state !== null || current,
      current,
      runningUnder: index.runningUnder(thread.id),
      project: { name, hue: hueOf(thread.projectId) },
      detail: detailOf(thread),
      asleepUntil,
    };
  };

  const sections = SECTION_KEYS.map((key) => {
    const members = placed.filter((p) => p.section === key);
    const ordered =
      key === "pinned"
        ? members.sort((a, b) => byPinOrder(a.thread, b.thread))
        : members.sort((a, b) => rankOf(b, key, input.now) - rankOf(a, key, input.now) || compare(a.thread.id, b.thread.id));
    return { key, rows: ordered.map(toRow) };
  });
  return { sections, index };
}

/**
 * The sleepers asking for you: their sleep ends now, for good, so they show Woke once answered and
 * never slip back to Asleep (Zeron: its host wakes it early).
 */
export function sleepersAskingForYou(input: Pick<ActivityInput, "threads" | "sleeps" | "now">): SleepRecord[] {
  return input.threads.filter(isListed).flatMap((t) => {
    const sleep = sleepOf(t, input.sleeps);
    return sleep !== undefined && sleep.until > input.now && asksForYou(stateOf(t, sleep, input.now)) ? [sleep] : [];
  });
}

/** When the row last moved, as its corner says: archived, when it was archived; else when it came back. */
export function lastMoved(t: PluginSidebarThread): number {
  return t.isArchived ? (t.archivedAt ?? t.updatedAt) : t.latestAttentionAt;
}

// ------------------------------------------------------------------ layer 2

/** Parents only; bb's hidden helpers never get a row. */
function isListed(t: PluginSidebarThread): boolean {
  return t.parentThreadId === null && !t.isHidden;
}

/** Only an active, unpinned thread sleeps: a pin holds its row in place, and Archived has left the work. */
function sleepOf(t: PluginSidebarThread, sleeps: ReadonlyMap<string, SleepRecord>): SleepRecord | undefined {
  return t.isArchived || t.isPinned ? undefined : sleeps.get(t.id);
}

function asksForYou(state: ZState | null): boolean {
  return state !== null && NEEDS_YOU.has(state);
}

/**
 * Archived first, then Pinned (a pin holds its row in place whatever it does), then Asleep until its
 * time unless it asks for you, then Working while under way;
 * the rest is Activity.
 */
function sectionOf(t: PluginSidebarThread, sleep: SleepRecord | undefined, state: ZState | null, now: number): SectionKey {
  if (t.isArchived) return "archived";
  if (t.isPinned) return "pinned";
  if (sleep !== undefined && sleep.until > now && !asksForYou(state)) return "asleep";
  if (state !== null && UNDER_WAY.has(state)) return "working";
  return "activity";
}

/**
 * Higher stands nearer the top. Asleep: the soonest to wake. Archived: the latest archived. The rest:
 * when it last came back, its own last move or waking from sleep; one
 * that woke early, asking for you, woke now. bb's attention time is the move: it advances when a turn
 * ends or fails, never when the thread is read (`updatedAt` does both).
 */
function rankOf({ thread, sleep }: { thread: PluginSidebarThread; sleep: SleepRecord | undefined }, section: SectionKey, now: number): number {
  if (section === "asleep") return -(sleep?.until ?? 0);
  if (section === "archived") return lastMoved(thread);
  return Math.max(thread.latestAttentionAt, sleep === undefined ? 0 : Math.min(sleep.until, now));
}

/** Its state's glyph; else, asleep, how soon it wakes; else when it last moved. */
function cornerOf(t: PluginSidebarThread, state: ZState | null, asleepUntil: number | null, now: number): Corner {
  if (state !== null) return { kind: "state", state };
  if (asleepUntil !== null) return { kind: "wakes", text: wakesIn(asleepUntil, now) };
  return { kind: "time", text: ago(lastMoved(t), now) };
}

function detailOf(t: PluginSidebarThread): RowDetail {
  return { machine: t.host?.name ?? null, branch: t.environment?.branchName ?? null };
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
