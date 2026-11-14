// Where every item stands: its y and height, computed, not measured. Pure.
// why: rows, titles, the gap and the padding are fixed, so the list knows where an off-screen row
// is, which is what windowing and motion need.
import type { ListItem } from "./items.ts";

export const METRICS = { padTop: 4, padBottom: 8, gap: 2, row: 30, tallRow: 46, title: 24 } as const;

export type LayoutEntry = { key: string; item: ListItem; y: number; h: number };

export type Layout = {
  entries: readonly LayoutEntry[];
  /** The scroll content's full height: at least the viewport's. */
  height: number;
  /** The scroller's height it was laid out for. */
  viewport: number;
};

/**
 * Lays items out top to bottom with the list's gap between them; a spacer takes the room left over.
 * `heights` overrides an item's height by key: the frame motion starts from (list/motion-plan.ts) holds a
 * leaving row at its old height and an arriving one at none.
 */
export function layoutItems(items: readonly ListItem[], viewport: number, heights: ReadonlyMap<string, number> = new Map()): Layout {
  const heightOf = (item: ListItem) => heights.get(item.key) ?? naturalHeight(item);
  const fixed = items.reduce((sum, item) => sum + heightOf(item), 0) + METRICS.gap * Math.max(0, items.length - 1);
  const spacer = Math.max(0, viewport - METRICS.padTop - METRICS.padBottom - fixed);

  const entries: LayoutEntry[] = [];
  let y = METRICS.padTop;
  for (const item of items) {
    const h = item.kind === "spacer" ? spacer : heightOf(item);
    entries.push({ key: item.key, item, y, h });
    y += h + METRICS.gap;
  }
  const bottom = entries.length === 0 ? METRICS.padTop : y - METRICS.gap;
  return { entries, height: Math.max(viewport, bottom + METRICS.padBottom), viewport };
}

/** How far past the view's edges items stay mounted. */
export const OVERSCAN = 160;

/** Keys of the entries that meet [top - overscan, top + height + overscan], found by binary search on y. */
export function visibleKeys(layout: Layout, top: number, height: number, overscan = OVERSCAN): string[] {
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
      return item.tall ? METRICS.tallRow : METRICS.row;
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
