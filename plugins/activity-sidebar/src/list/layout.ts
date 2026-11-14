// Where every item stands: its y and height, computed, not measured. Pure.
// why: rows, titles, the gap and the padding are fixed, so the list knows where an off-screen row
// is, which is what windowing (and issue 08's motion) needs.
import type { ListItem } from "./items.ts";

export const METRICS = { padTop: 4, padBottom: 8, gap: 2, row: 30, title: 24 } as const;

export type LayoutEntry = { key: string; item: ListItem; y: number; h: number };

export type Layout = {
  entries: readonly LayoutEntry[];
  /** The scroll content's full height: at least the viewport's. */
  height: number;
};

/** Lays items out top to bottom with the list's gap between them; a spacer takes the room left over. */
export function layoutItems(items: readonly ListItem[], viewport: number): Layout {
  const fixed = items.reduce((sum, item) => sum + naturalHeight(item), 0) + METRICS.gap * Math.max(0, items.length - 1);
  const spacer = Math.max(0, viewport - METRICS.padTop - METRICS.padBottom - fixed);

  const entries: LayoutEntry[] = [];
  let y = METRICS.padTop;
  for (const item of items) {
    const h = item.kind === "spacer" ? spacer : naturalHeight(item);
    entries.push({ key: item.key, item, y, h });
    y += h + METRICS.gap;
  }
  const bottom = entries.length === 0 ? METRICS.padTop : y - METRICS.gap;
  return { entries, height: Math.max(viewport, bottom + METRICS.padBottom) };
}

/** Keys of the entries that meet [top - overscan, top + height + overscan], found by binary search on y. */
export function visibleKeys(layout: Layout, top: number, height: number, overscan = 160): string[] {
  const from = top - overscan;
  const to = top + height + overscan;
  const keys: string[] = [];
  for (let i = firstEndingAfter(layout.entries, from); i < layout.entries.length && layout.entries[i].y < to; i++) {
    keys.push(layout.entries[i].key);
  }
  return keys;
}

// ------------------------------------------------------------------ layer 2

function naturalHeight(item: ListItem): number {
  switch (item.kind) {
    case "title":
      return METRICS.title;
    case "row":
    case "more":
    case "notice":
      return METRICS.row;
    case "spacer":
      return 0;
  }
}

/** The index of the first entry whose bottom passes `y`. */
function firstEndingAfter(entries: readonly LayoutEntry[], y: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].y + entries[mid].h <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
