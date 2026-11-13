// The scroller: lays the items out, mounts only what is on screen, and owns the list's keyboard.
// Every item is absolutely placed at its computed y.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { heirOf } from "../list/focus.ts";
import type { ListItem } from "../list/items.ts";
import { layoutItems, METRICS, visibleKeys, type Layout, type LayoutEntry } from "../list/layout.ts";
import { Row } from "./row.tsx";
import { Notice, SectionTitle } from "./shelf-title.tsx";

type Props = { items: readonly ListItem[]; onNavigate(): void };

export function ListViewport({ items, onNavigate }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>()).current;
  const height = useHeight(scroller);
  const [top, setTop] = useState(0);
  const layout = useMemo(() => layoutItems(items, height), [items, height]);
  const rowKeys = useMemo(() => rowsOf(layout).map((entry) => entry.key), [layout]);
  const focus = useRowFocus(nodes, rowKeys, scroller);

  // why: the focused row stays mounted when it scrolls away, so focus never drops to the page.
  const mounted = new Set(visibleKeys(layout, top, height));
  if (focus.key !== null) mounted.add(focus.key);

  return (
    <div
      ref={scroller}
      className="as-scroller"
      tabIndex={0}
      aria-label="Threads"
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      onFocus={(e) => focus.track(e.target)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) focus.track(null);
      }}
      onKeyDown={(e) => moveFocus(e, layout, focus, scroller)}
    >
      <div style={{ height: layout.height }} />
      {layout.entries
        .filter((entry) => mounted.has(entry.key))
        .map((entry) => (
          <Placed key={entry.key} entry={entry} nodes={nodes}>
            {renderItem(entry.item, onNavigate)}
          </Placed>
        ))}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

function renderItem(item: ListItem, onNavigate: () => void): ReactNode {
  switch (item.kind) {
    case "row":
      return <Row row={item.row} onNavigate={onNavigate} />;
    case "title":
      return <SectionTitle label={item.label} />;
    case "notice":
      return <Notice text={item.text} />;
    case "spacer":
      return null;
    default:
      item satisfies never;
      return null;
  }
}

/** An item at its y, registered under its key so the keyboard can focus it. */
function Placed({ entry, nodes, children }: { entry: LayoutEntry; nodes: Map<string, HTMLElement>; children: ReactNode }) {
  return (
    <div
      className="as-item"
      data-key={entry.key}
      style={{ transform: `translateY(${entry.y}px)`, height: entry.h }}
      ref={(node) => {
        if (node) nodes.set(entry.key, node);
        else nodes.delete(entry.key);
      }}
    >
      {children}
    </div>
  );
}

type RowFocus = {
  /** The key of the row holding focus, or the row the keyboard is moving focus to. */
  key: string | null;
  track(target: EventTarget | null): void;
  moveTo(key: string): void;
};

/**
 * Follows focus by key, not index, so a row keeps focus when the list reorders around it. When the
 * focused row's thread leaves the list (archived or deleted elsewhere), focus passes to its neighbour,
 * or to the scroller once no row is left. A null key means focus is outside the list: nothing moves.
 */
function useRowFocus(nodes: Map<string, HTMLElement>, rowKeys: readonly string[], scroller: RefObject<HTMLElement | null>): RowFocus {
  const [key, setKey] = useState<string | null>(null);
  const moving = useRef(false);
  const lastRows = useRef(rowKeys);

  useLayoutEffect(() => {
    const before = lastRows.current;
    lastRows.current = rowKeys;
    if (key === null || rowKeys.includes(key)) return;
    const heir = heirOf(before, key, new Set(rowKeys));
    moving.current = heir !== null;
    setKey(heir);
    if (heir === null) scroller.current?.focus({ preventScroll: true });
  }, [key, rowKeys, scroller]);

  useLayoutEffect(() => {
    if (!moving.current || key === null) return;
    moving.current = false;
    nodes.get(key)?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  }, [key, nodes]);

  return {
    key,
    track(target) {
      const item = target instanceof HTMLElement ? target.closest<HTMLElement>(".as-item") : null;
      setKey(item?.dataset.key ?? null);
    },
    moveTo(next) {
      moving.current = true;
      setKey(next);
    },
  };
}

/** ↑/↓ move between rows, scrolling the next one into view first. Enter opens: the row is a link. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>, layout: Layout, focus: RowFocus, scroller: RefObject<HTMLDivElement | null>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const el = scroller.current;
  const rows = rowsOf(layout);
  if (el === null || rows.length === 0) return;
  e.preventDefault();

  const at = rows.findIndex((entry) => entry.key === focus.key);
  const step = e.key === "ArrowDown" ? 1 : -1;
  const next = at === -1 ? firstBelow(rows, el.scrollTop) : rows[Math.max(0, Math.min(rows.length - 1, at + step))];
  if (next.y < el.scrollTop + METRICS.padTop) el.scrollTop = next.y - METRICS.padTop;
  else if (next.y + next.h > el.scrollTop + el.clientHeight - METRICS.padBottom) el.scrollTop = next.y + next.h - el.clientHeight + METRICS.padBottom;
  focus.moveTo(next.key);
}

function rowsOf(layout: Layout): LayoutEntry[] {
  return layout.entries.filter((entry) => entry.item.kind === "row");
}

/** From the scroller itself, the keyboard starts at the first row in view. */
function firstBelow(rows: readonly LayoutEntry[], scrollTop: number): LayoutEntry {
  return rows.find((entry) => entry.y >= scrollTop) ?? rows[rows.length - 1];
}

/** The scroller's height, kept current by a ResizeObserver. */
function useHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
