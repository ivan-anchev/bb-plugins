// The scroller: lays the items out, mounts only what is on screen, and owns the list's keyboard.
// Every item is absolutely placed at its computed y; ui/motion carries it there from where it stood.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { heirOf } from "../list/focus.ts";
import type { ListItem, NoticeKey } from "../list/items.ts";
import type { SectionKey } from "../model/activity.ts";
import { layoutItems, METRICS, visibleKeys, type Layout, type LayoutEntry } from "../list/layout.ts";
import type { Ghost } from "../list/motion-plan.ts";
import { cardKeyOf, HoverCard, type CardData } from "./card/hover-card.tsx";
import { useLayoutMotion } from "./motion/use-layout-motion.ts";
import { Row } from "./row/row.tsx";
import type { RowSleep } from "./row/row-menu.tsx";
import { MoreRow, Notice, SectionTitle } from "./shelf-title.tsx";

/** What the items do when pressed; the viewport only places them. */
type ItemActions = {
  onNavigate(): void;
  sleep: RowSleep;
  onToggle(section: SectionKey): void;
  onShowMoreArchived(): void;
  /** A notice's Retry: read again what it says failed. */
  onRetry(notice: NoticeKey): void;
  /** Sits at the end of Activity's title. */
  viewMenu: ReactNode;
};

/** `card`: what the hover card reads; null where no card shows (a compact viewport). */
type Props = ItemActions & { items: readonly ListItem[]; card: CardData | null };

export function ListViewport({ items, card, ...actions }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>()).current;
  const height = useHeight(scroller);
  const [top, setTop] = useState(0);
  const layout = useMemo(() => layoutItems(items, height), [items, height]);
  const stopKeys = useMemo(() => stopsOf(layout).map((entry) => entry.key), [layout]);
  const focus = useStopFocus(nodes, stopKeys, scroller);
  const motion = useLayoutMotion(layout, nodes, { top, height });

  // why: the focused item stays mounted when it scrolls away or while its menu is open, so focus never
  // drops to the page, and a closing menu can hand focus back to its trigger. An item on its way across
  // the view stays mounted until it lands, so one gliding out of view is seen going.
  const mounted = new Set([...visibleKeys(layout, top, height), ...motion.passing]);
  if (focus.key !== null) mounted.add(focus.key);

  return (
    <>
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
        {/* why: clipped to the layout's height, so what moves never changes how far the list scrolls. */}
        <div className="as-content" style={{ height: layout.height }}>
          {layout.entries
            .filter((entry) => mounted.has(entry.key))
            .map((entry) => (
              <Placed key={entry.key} entry={entry} nodes={nodes} onFocus={() => focus.hold(entry.key)}>
                {renderItem(entry.item, actions)}
              </Placed>
            ))}
          {motion.ghosts.map((ghost) => (
            <Gone key={`ghost:${ghost.entry.key}`} ghost={ghost} nodeRef={motion.ghostRef(ghost.entry.key)}>
              {renderItem(ghost.entry.item, actions)}
            </Gone>
          ))}
        </div>
        {/* why: in here, so focus leaving the card (portaled; it adds nothing here) bubbles to onBlur above, as a menu's does. */}
        {card !== null && <HoverCard scroller={scroller} items={items} data={card} listFocus={focus} onNavigate={actions.onNavigate} />}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ layer 2

function renderItem(item: ListItem, actions: ItemActions): ReactNode {
  switch (item.kind) {
    case "row":
      return <Row row={item.row} tall={item.tall} sleep={actions.sleep} onNavigate={actions.onNavigate} />;
    case "title":
      return <SectionTitle item={item} onToggle={() => actions.onToggle(item.section)} action={item.section === "activity" ? actions.viewMenu : null} />;
    case "more":
      return <MoreRow n={item.n} onPress={actions.onShowMoreArchived} />;
    case "notice":
      return <Notice text={item.text} onRetry={item.retry ? () => actions.onRetry(item.key) : null} />;
    case "spacer":
      return null;
    default:
      item satisfies never;
      return null;
  }
}

/**
 * An item at its y, registered under its key so the keyboard can focus it. React bubbles focus through
 * portals, so `onFocus` also fires for a menu the item opens. A row carries its card key, which the
 * hover card finds it by.
 */
function Placed({ entry, nodes, onFocus, children }: { entry: LayoutEntry; nodes: Map<string, HTMLElement>; onFocus(): void; children: ReactNode }) {
  return (
    <div
      className="as-item"
      data-key={entry.key}
      data-card={entry.item.kind === "row" ? cardKeyOf(entry.item) : undefined}
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

/** A leaver as it stood, closing away: out of reach of the pointer, the keyboard and screen readers. */
function Gone({ ghost, nodeRef, children }: { ghost: Ghost; nodeRef(node: HTMLElement | null): void; children: ReactNode }) {
  return (
    <div className="as-item as-ghost" aria-hidden inert style={{ transform: `translateY(${ghost.entry.y}px)`, height: ghost.entry.h }} ref={nodeRef}>
      {children}
    </div>
  );
}

type StopFocus = {
  /** The key of the item holding focus, or the item the keyboard is moving focus to. */
  key: string | null;
  /** Focus entered the item under `key` (itself, a menu it portals, or its hover card), or left the list (null). */
  hold(key: string | null): void;
  moveTo(key: string): void;
  /** Focus back onto the item holding it, from a portaled part of it that went (its hover card). */
  refocus(): void;
};

/**
 * Follows focus by key, not index, so an item keeps focus when the list reorders around it. When the
 * focused item leaves the list (its thread archived or deleted elsewhere, its section folded), focus
 * passes to its neighbour, or to the scroller once none is left. A null key means focus is outside the
 * list: nothing moves. Focus in a menu an item portals (the project filter) or in a row's hover card is
 * still that item's.
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
    focusItem(nodes, key);
  }, [key, nodes]);

  return {
    key,
    hold: setKey,
    moveTo(next) {
      moving.current = true;
      setKey(next);
    },
    refocus() {
      if (key !== null) focusItem(nodes, key);
    },
  };
}

/** A row is its link; a title, "Show more" or a notice is its first button. */
function focusItem(nodes: Map<string, HTMLElement>, key: string) {
  nodes.get(key)?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
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
