import type { SectionKey } from "../model/activity.ts";
import type { ListItem } from "./items.ts";
import { layoutItems, METRICS, type Layout, type LayoutEntry } from "./layout.ts";

export const EASE = "cubic-bezier(.25,.1,.25,1)";
export const OUT3 = "cubic-bezier(.33,1,.68,1)";
const SLIDE = 260;
const FADE = 160;
const OPEN = 260;
const CLOSE = 240;
const GO = 90;
const COME = 180;
const COME_AFTER = 140;

/** A glide's length by how far it goes: 180, longer by √(distance / 256), at most 240. */
export function glideMs(distance: number): number {
  return 180 * Math.min(Math.max(Math.sqrt(Math.abs(distance) / 256), 1), 240 / 180);
}

export type Timing = { ms: number; delay: number; easing: string };

/** translateY(from) easing to none, added onto the item's own translateY(y). */
export type Segment = { from: number; timing: Timing };

/** An item already in the list taking its new place: a glide in the order, a slide for the room around it, or both at once. */
export type Move = { key: string; segments: readonly Segment[] };

/**
 * An item new to a section, opening top to bottom where it lands, then fading in. `window`: the share of
 * `reveal` its opening takes. Alone, all of it; a section unfolding opens as one, its edge crossing each
 * row in turn.
 */
export type Arrival = { key: string; reveal: Timing; window: readonly [number, number]; fade: Timing };

/** An item gone from a section, drawn where it stood in the frame the move starts from until it has faded and closed. */
export type Ghost = { entry: LayoutEntry; collapse: Timing; fade: Timing };

export type MotionPlan = { moves: readonly Move[]; arrivals: readonly Arrival[]; ghosts: readonly Ghost[] };

/** Nothing moves. */
export const STILL: MotionPlan = { moves: [], arrivals: [], ghosts: [] };

/**
 * The move from `prev` to `next`. A section whose title opened or closed between them is a fold: only its
 * own items come or go, on the fold's timing, and the rest slide on it. Otherwise it is the data moving:
 * rows glide to their new places, come and go in their sections, and the rest slide.
 */
export function planMotion(prev: Layout, next: Layout): MotionPlan {
  if (prev.viewport !== next.viewport || prev.entries.some((e) => e.key === "n:list")) return STILL;

  const before = byKey(prev.entries);
  const fold = foldBetween(before, next);
  const t = timingsOf(fold);
  const animates = (item: ListItem) => glides(item) && (fold === null || sectionOf(item) === fold.section);
  const arriving = next.entries.filter((e) => !before.has(e.key) && animates(e.item));
  const after = byKey(next.entries);
  const leaving = prev.entries.filter((e) => !after.has(e.key) && animates(e.item));

  const mid = midFrame(prev, next, arriving, leaving);
  const room = (e: LayoutEntry) => mid.get(e.key)!.y - e.y;
  const arrivingKeys = new Set(arriving.map((e) => e.key));
  const slideOf = (e: LayoutEntry) => (fold !== null && arrivingKeys.has(e.key) ? room(arriving[0]) : room(e));
  const block = span(arriving);
  const moves = next.entries.flatMap((e) => moveOf(e, before.get(e.key), mid.get(e.key)!, slideOf(e), t.slide));
  const ghosts = leaving.flatMap((e) => {
    const at = mid.get(e.key);
    return at === undefined ? [] : [{ entry: at, collapse: t.collapse, fade: t.fadeOut }];
  });
  if (moves.length + arriving.length + ghosts.length === 0) return STILL;
  return {
    moves,
    arrivals: arriving.map((e) => ({ key: e.key, reveal: t.reveal, fade: t.fadeIn, window: fold === null ? [0, 1] : windowIn(block, e) })),
    ghosts,
  };
}

type Fold = { section: SectionKey; opening: boolean };
type Timings = Record<"slide" | "reveal" | "fadeIn" | "collapse" | "fadeOut", Timing>;

function glides(item: ListItem): boolean {
  return item.kind === "row" || item.kind === "more";
}

function sectionOf(item: ListItem): SectionKey | null {
  switch (item.kind) {
    case "row":
    case "title":
      return item.section;
    case "more":
      return "archived";
    case "notice":
    case "spacer":
      return null;
  }
}

function foldBetween(before: ReadonlyMap<string, LayoutEntry>, next: Layout): Fold | null {
  for (const { item } of next.entries) {
    const was = before.get(item.key)?.item;
    if (item.kind === "title" && was?.kind === "title" && was.open !== item.open) return { section: item.section, opening: item.open };
  }
  return null;
}

function timingsOf(fold: Fold | null): Timings {
  if (fold === null) {
    const slide = timing(SLIDE, OUT3);
    return { slide, reveal: slide, fadeIn: timing(FADE, EASE), collapse: slide, fadeOut: timing(FADE, EASE) };
  }
  if (fold.opening) {
    const open = timing(OPEN, EASE);
    return { slide: open, reveal: open, fadeIn: timing(COME, EASE, COME_AFTER), collapse: open, fadeOut: open };
  }
  const close = timing(CLOSE, EASE, GO);
  return { slide: close, reveal: close, fadeIn: close, collapse: close, fadeOut: timing(GO, EASE) };
}

function timing(ms: number, easing: string, delay = 0): Timing {
  return { ms, delay, easing };
}

function midFrame(prev: Layout, next: Layout, arriving: readonly LayoutEntry[], leaving: readonly LayoutEntry[]): Map<string, LayoutEntry> {
  const items = next.entries.map((e) => e.item);
  for (const gone of leaving) {
    const at = ghostIndex(items, gone, prev);
    if (at !== null) items.splice(at, 0, gone.item);
  }
  const heights = new Map([...arriving.map((e) => [e.key, -METRICS.gap] as const), ...leaving.map((e) => [e.key, e.h] as const)]);
  return byKey(layoutItems(items, next.viewport, heights).entries);
}

function ghostIndex(items: readonly ListItem[], gone: LayoutEntry, prev: Layout): number | null {
  const section = sectionOf(gone.item);
  const before = prev.entries[prev.entries.indexOf(gone) - 1].key;
  const after = items.findIndex((item) => item.key === before && sectionOf(item) === section);
  if (after !== -1) return after + 1;
  const title = items.findIndex((item) => item.kind === "title" && item.section === section);
  return title === -1 ? null : title + 1;
}

function moveOf(entry: LayoutEntry, was: LayoutEntry | undefined, mid: LayoutEntry, room: number, slide: Timing): Move[] {
  if (entry.item.kind === "spacer") return [];
  const segments: Segment[] = [];
  const glide = was === undefined ? 0 : was.y - mid.y;
  if (glides(entry.item) && Math.abs(glide) > 0.5) segments.push({ from: glide, timing: timing(glideMs(glide), EASE) });
  if (Math.abs(room) > 0.5) segments.push({ from: room, timing: slide });
  return segments.length === 0 ? [] : [{ key: entry.key, segments }];
}

function span(entries: readonly LayoutEntry[]): { top: number; bottom: number } {
  return { top: Math.min(...entries.map((e) => e.y)), bottom: Math.max(...entries.map((e) => e.y + e.h)) };
}

function windowIn(block: { top: number; bottom: number }, entry: LayoutEntry): readonly [number, number] {
  const h = block.bottom - block.top;
  return [(entry.y - block.top) / h, (entry.y + entry.h - block.top) / h];
}

function byKey(entries: readonly LayoutEntry[]): Map<string, LayoutEntry> {
  return new Map(entries.map((e) => [e.key, e]));
}
