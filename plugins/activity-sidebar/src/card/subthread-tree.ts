// The hover card's subthread tree as lines (P:1291-1352): every subthread in a state and the path to
// it, then the two latest of each place; checkouts on one branch are one place, said once; twelve lines
// at most. Each line carries where its hairline rail runs. Pure over the list's ThreadIndex.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { baseState, UNDER_WAY, type ZState } from "../model/state.ts";
import type { ThreadIndex } from "../model/thread-index.ts";

/** Where a thread's work runs (Zeron's checkout kinds). `branch` null: no branch known. */
export type Checkout = { kind: "worktree" | "checkout" | "workspace"; branch: string | null };

/**
 * Where a line hangs: `at` the x of the trunk it hangs from, `indent` where its body starts, `last` the
 * trunk ends at it, `through` the x of the outer trunks running on past it.
 */
export type Rail = { at: number; indent: number; last: boolean; through: readonly number[] };

export type TreeLine =
  | ({ kind: "thread"; thread: PluginSidebarThread; state: ZState | null } & Rail)
  /** The head of subthreads running in another checkout: `threads` under it, over `checkouts` checkouts. */
  | ({ kind: "place"; checkout: Checkout; threads: number; checkouts: number } & Rail);

/** `total` every subthread below; `running` those under way; `hidden` those no line shows. */
export type SubthreadTree = { lines: readonly TreeLine[]; total: number; running: number; hidden: number };

const MAX_LINES = 12;
const QUIET_PER_PLACE = 2;
/** The root trunk's x; a line's body starts STEP past its trunk; a mark's slot is SLOT wide. */
const ROOT_AT = 6;
const STEP = 8;
const SLOT = 20;

/** Zeron's URGENCY (P:298), most pressing first; a thread in no state sorts after every state. */
const URGENCY: Record<ZState, number> = { approval: 1, input: 2, failed: 3, working: 5, waiting: 6, connecting: 7, done: 9, woke: 9 };
const QUIET = 99;

export function subthreadLines(index: ThreadIndex, parent: PluginSidebarThread): SubthreadTree {
  const lines: TreeLine[] = [];
  walk(index, parent, ROOT_AT, [], lines);
  const shown = dropTrailingPlaces(lines.slice(0, MAX_LINES));
  const all = index.below(parent.id);
  return {
    lines: shown,
    total: all.length,
    // why: every subthread under way, as the row's pill counts them, not only its children (P:1311).
    running: all.filter(isUnderWay).length,
    hidden: all.length - shown.filter((l) => l.kind === "thread").length,
  };
}

/** Where a thread's work runs, from its environment (SDK:22511-22531). */
export function checkoutOf(thread: PluginSidebarThread): Checkout {
  const env = thread.environment;
  if (env?.isWorktree) return { kind: "worktree", branch: env.branchName };
  return env?.branchName ? { kind: "checkout", branch: env.branchName } : { kind: "workspace", branch: null };
}

// ------------------------------------------------------------------ layer 2

type Place = { checkout: Checkout; list: readonly PluginSidebarThread[]; keep: readonly PluginSidebarThread[] };

/**
 * The lines under `node`. Its subthreads in its own checkout hang straight off it; those elsewhere hang
 * under one head per place, so where the work runs is said once (P:1296-1330).
 */
function walk(index: ThreadIndex, node: PluginSidebarThread, at: number, through: readonly number[], out: TreeLine[]): void {
  const kids = index.childrenOf(node.id);
  if (kids.length === 0) return;
  const { own, places } = byPlace(index, kids, node.environment?.id ?? null);
  const items = [...own.map((thread) => ({ kind: "thread" as const, thread })), ...places.map((place) => ({ kind: "place" as const, place }))];

  items.forEach((item, i) => {
    const last = i === items.length - 1;
    const indent = at + STEP;
    const mid = indent + SLOT / 2;
    const on = last ? through : [...through, at];
    if (item.kind === "thread") {
      out.push(threadLine(item.thread, { at, indent, last, through }));
      walk(index, item.thread, mid, on, out);
      return;
    }
    const { place } = item;
    out.push({ kind: "place", checkout: place.checkout, threads: place.list.length, checkouts: new Set(place.list.map(envId)).size, at, indent, last, through });
    place.keep.forEach((thread, j) => {
      const lastKid = j === place.keep.length - 1;
      out.push(threadLine(thread, { at: mid, indent: mid + STEP, last: lastKid, through: on }));
      walk(index, thread, mid + STEP + SLOT / 2, lastKid ? on : [...on, mid], out);
    });
  });
}

/**
 * Its own checkout's chosen subthreads, and every other place (one per kind and branch, so worktrees on
 * one branch merge) that keeps any, the latest-moved place first.
 */
function byPlace(index: ThreadIndex, kids: readonly PluginSidebarThread[], ownEnv: string | null): { own: PluginSidebarThread[]; places: Place[] } {
  const own: PluginSidebarThread[] = [];
  const groups = new Map<string, PluginSidebarThread[]>();
  for (const kid of kids) {
    if (envId(kid) === ownEnv) {
      own.push(kid);
      continue;
    }
    const c = checkoutOf(kid);
    const key = `${c.kind}:${c.branch ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), kid]);
  }
  const places = [...groups.values()]
    .sort((a, b) => latest(b) - latest(a))
    .map((list) => ({ checkout: checkoutOf(list[0]), list, keep: choose(index, list) }))
    .filter((place) => place.keep.length > 0);
  return { own: choose(index, own), places };
}

/**
 * In a state, or on the path to one: kept, the most pressing first, so the cut never hides them behind
 * quiet ones. Of the quiet, the two latest (P:1293-1297).
 */
function choose(index: ThreadIndex, list: readonly PluginSidebarThread[]): PluginSidebarThread[] {
  const rank = (t: PluginSidebarThread) => Math.min(urgency(t), ...index.below(t.id).map(urgency));
  const sorted = [...list].sort((a, b) => rank(a) - rank(b) || b.latestAttentionAt - a.latestAttentionAt);
  const quiet = new Set(sorted.filter((t) => rank(t) === QUIET).slice(0, QUIET_PER_PLACE));
  return sorted.filter((t) => rank(t) !== QUIET || quiet.has(t));
}

/** A head with none of its rows left after the cut goes with them (P:1331). */
function dropTrailingPlaces(lines: TreeLine[]): TreeLine[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].kind === "place") end--;
  return lines.slice(0, end);
}

function threadLine(thread: PluginSidebarThread, rail: Rail): TreeLine {
  return { kind: "thread", thread, state: baseState(thread), ...rail };
}

function envId(thread: PluginSidebarThread): string | null {
  return thread.environment?.id ?? null;
}

function latest(list: readonly PluginSidebarThread[]): number {
  return Math.max(...list.map((t) => t.latestAttentionAt));
}

// why: a subthread never sleeps, so its base state is its state.
function urgency(thread: PluginSidebarThread): number {
  const state = baseState(thread);
  return state === null ? QUIET : URGENCY[state];
}

function isUnderWay(thread: PluginSidebarThread): boolean {
  const state = baseState(thread);
  return state !== null && UNDER_WAY.has(state);
}
