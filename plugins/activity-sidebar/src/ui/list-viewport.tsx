// The scroller: lays the items out, mounts only what is on screen, and owns the list's keyboard.
// Every item is absolutely placed at its computed y.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { heirOf } from "../list/focus.ts";
import type { ListItem } from "../list/items.ts";
import type { SectionKey } from "../model/activity.ts";
import { layoutItems, METRICS, visibleKeys, type Layout, type LayoutEntry } from "../list/layout.ts";
import { Row } from "./row/row.tsx";
import { MoreRow, Notice, SectionTitle } from "./shelf-title.tsx";

/** What the items do when pressed; the viewport only places them. */
type ItemActions = {
  onNavigate(): void;
  onToggle(section: SectionKey): void;
  onShowMoreArchived(): void;
  onRetryArchived(): void;
  /** Sits at the end of Activity's title. */
  filterMenu: ReactNode;
};

type Props = ItemActions & { items: readonly ListItem[] };

export function ListViewport({ items, ...actions }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>()).current;
  const height = useHeight(scroller);
  const [top, setTop] = useState(0);
  const layout = useMemo(() => layoutItems(items, height), [items, height]);
  const stopKeys = useMemo(() => stopsOf(layout).map((entry) => entry.key), [layout]);
  const focus = useStopFocus(nodes, stopKeys, scroller);

  // why: the focused item stays mounted when it scrolls away or while its menu is open, so focus never
  // drops to the page, and a closing menu can hand focus back to its trigger.
  const mounted = new Set(visibleKeys(layout, top, height));
  if (focus.key !== null) mounted.add(focus.key);

  return (
    <div
      ref={scroller}
      className="as-scroller"
      tabIndex={0}
      aria-label="Threads"
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) focus.hold(null);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) focus.hold(null);
      }}
      onKeyDown={(e) => moveFocus(e, layout, focus, scroller)}
    >
      <div style={{ height: layout.height }} />
      {layout.entries
        .filter((entry) => mounted.has(entry.key))
        .map((entry) => (
          <Placed key={entry.key} entry={entry} nodes={nodes} onFocus={() => focus.hold(entry.key)}>
            {renderItem(entry.item, actions)}
          </Placed>
        ))}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

function renderItem(item: ListItem, actions: ItemActions): ReactNode {
  switch (item.kind) {
    case "row":
      return <Row row={item.row} onNavigate={actions.onNavigate} />;
    case "title":
      return <SectionTitle item={item} onToggle={() => actions.onToggle(item.section)} action={item.section === "activity" ? actions.filterMenu : null} />;
    case "more":
      return <MoreRow n={item.n} onPress={actions.onShowMoreArchived} />;
    case "notice":
      return <Notice text={item.text} onRetry={item.retry ? actions.onRetryArchived : null} />;
    case "spacer":
      return null;
    default:
      item satisfies never;
      return null;
  }
}

/**
 * An item at its y, registered under its key so the keyboard can focus it. React bubbles focus through
 * portals, so `onFocus` also fires for a menu the item opens.
 */
function Placed({ entry, nodes, onFocus, children }: { entry: LayoutEntry; nodes: Map<string, HTMLElement>; onFocus(): void; children: ReactNode }) {
  return (
    <div
      className="as-item"
      data-key={entry.key}
      onFocus={onFocus}
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

type StopFocus = {
  /** The key of the item holding focus, or the item the keyboard is moving focus to. */
  key: string | null;
  /** Focus entered the item under `key` (itself or a menu it portals), or left the list (null). */
  hold(key: string | null): void;
  moveTo(key: string): void;
};

/**
 * Follows focus by key, not index, so an item keeps focus when the list reorders around it. When the
 * focused item leaves the list (its thread archived or deleted elsewhere, its section folded), focus
 * passes to its neighbour, or to the scroller once none is left. A null key means focus is outside the
 * list: nothing moves. Focus in a menu an item portals (the project filter) is still that item's.
 */
function useStopFocus(nodes: Map<string, HTMLElement>, stopKeys: readonly string[], scroller: RefObject<HTMLElement | null>): StopFocus {
  const [key, setKey] = useState<string | null>(null);
  const moving = useRef(false);
  const lastStops = useRef(stopKeys);

  useLayoutEffect(() => {
    const before = lastStops.current;
    lastStops.current = stopKeys;
    if (key === null || stopKeys.includes(key)) return;
    const heir = heirOf(before, key, new Set(stopKeys));
    moving.current = heir !== null;
    setKey(heir);
    if (heir === null) scroller.current?.focus({ preventScroll: true });
  }, [key, stopKeys, scroller]);

  useLayoutEffect(() => {
    if (!moving.current || key === null) return;
    moving.current = false;
    // why: a row is its link; a title, "Show more" or a notice is its first button.
    nodes.get(key)?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, [key, nodes]);

  return {
    key,
    hold: setKey,
    moveTo(next) {
      moving.current = true;
      setKey(next);
    },
  };
}

/**
 * ↑/↓ move between the stops (rows, titles, "Show more", Retry), scrolling the next one into view
 * first. Enter acts: a row is a link, the rest are buttons. A key another control already handled, or
 * one pressed in a portaled menu (React bubbles it here), belongs to that control.
 */
function moveFocus(e: KeyboardEvent<HTMLDivElement>, layout: Layout, focus: StopFocus, scroller: RefObject<HTMLDivElement | null>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.defaultPrevented || !(e.target instanceof Node && e.currentTarget.contains(e.target))) return;
  const el = scroller.current;
  const stops = stopsOf(layout);
  if (el === null || stops.length === 0) return;
  e.preventDefault();

  const at = stops.findIndex((entry) => entry.key === focus.key);
  const step = e.key === "ArrowDown" ? 1 : -1;
  const next = at === -1 ? firstBelow(stops, el.scrollTop) : stops[Math.max(0, Math.min(stops.length - 1, at + step))];
  if (next.y < el.scrollTop + METRICS.padTop) el.scrollTop = next.y - METRICS.padTop;
  else if (next.y + next.h > el.scrollTop + el.clientHeight - METRICS.padBottom) el.scrollTop = next.y + next.h - el.clientHeight + METRICS.padBottom;
  focus.moveTo(next.key);
}

/** The items ↑/↓ stop on: everything that acts when pressed. */
function stopsOf(layout: Layout): LayoutEntry[] {
  return layout.entries.filter(({ item }) => item.kind === "row" || item.kind === "title" || item.kind === "more" || (item.kind === "notice" && item.retry));
}

/** From the scroller itself, the keyboard starts at the first stop in view. */
function firstBelow(stops: readonly LayoutEntry[], scrollTop: number): LayoutEntry {
  return stops.find((entry) => entry.y >= scrollTop) ?? stops[stops.length - 1];
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
