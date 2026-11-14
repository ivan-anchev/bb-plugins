// The list's hover card. CardIntent (src/card/card-intent.ts) decides which row's card shows, fed by
// pointer and focus events delegated on the scroller, and by the pointer's moves anywhere while a card
// shows. Radix Popover (shimmed by the host, so it shares bb's overlay layer) places it beside that row,
// kept inside the window, and closes it on Escape wherever focus is. A card leaving fades out while the
// next fades in. The keyboard reaches it from its row: Tab goes in,
// first to its body, which the arrow keys then scroll, and on through its buttons. Shift+Tab off its
// first stop or Escape comes back, and Tab off its last goes on to what follows the list. Focus in the
// card is its row's to the list.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Anchor, Content, Portal, Root } from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { CardIntent, type CardIntentDeps, type Point, type Under } from "../../card/card-intent.ts";
import type { ListItem } from "../../list/items.ts";
import type { LayoutEntry } from "../../list/layout.ts";
import type { ThreadIndex } from "../../model/thread-index.ts";
import { PORTAL_SCOPE } from "../portal-scope.ts";
import { CardBody } from "./card-body.tsx";

/** What a card reads beyond its row: who hangs under whom, and since when each thread has worked. */
export type CardData = { index: ThreadIndex; underWaySince: ReadonlyMap<string, number> };

export type RowItem = Extract<ListItem, { kind: "row" }>;

/**
 * A row in its place: its section and thread. A row that moves to another section (archived, put to
 * sleep, done working) is another row, so its card goes with the old one.
 */
export function cardKeyOf(item: RowItem): string {
  return `${item.section}/${item.row.thread.id}`;
}

/** The list's keyboard focus, which counts focus in a card as its row's. */
export type ListFocus = {
  /** Focus is on the item under `key`. */
  hold(key: string): void;
  /** Put focus back on the item holding it. */
  refocus(): void;
};

/** A row where the list lays it out: `y` from the list's top, `h` its height. */
type PlacedRow = { item: RowItem; y: number; h: number };

type Props = { scroller: RefObject<HTMLElement | null>; entries: readonly LayoutEntry[]; data: CardData; listFocus: ListFocus; onNavigate(): void };

/** The card shown, and the one fading out behind it; null, none. */
type Shown = { current: string | null; leaving: string | null };

export function HoverCard({ scroller, entries, data, listFocus, onNavigate }: Props) {
  const [shown, setShown] = useState<Shown>({ current: null, leaving: null });
  const card = useRef<HTMLDivElement>(null);
  const latestFocus = useRef(listFocus);
  useLayoutEffect(() => {
    latestFocus.current = listFocus;
  });
  const intent = useCardIntent(scroller, card, shown.current !== null, {
    onChange: (key) => setShown((was) => ({ current: key, leaving: was.current ?? was.leaving })),
    returnFocus: () => latestFocus.current.refocus(),
  });
  const navigate = useBbNavigate();
  const current = placedRow(entries, shown.current);

  // It goes with its row: filtered out, folded away, moved to another section, deleted. Focus that was in
  // it still counts as there: React turns events off while it commits, so the card's removal reports no
  // blur, and CardIntent hands focus back to the row (or the list's heir for it) as it puts the card away.
  useEffect(() => {
    if (shown.current !== null && current === null) intent.cold();
  }, [shown.current, current, intent]);

  const open = (threadId: string) => {
    intent.cold();
    navigate.toThread(threadId);
    onNavigate();
  };

  // why: one array, so a card keeps its instance (and plays its exit) as it turns from shown to leaving.
  const cards = [shown.leaving, shown.current].filter((key, i, all): key is string => key !== null && all.indexOf(key) === i);
  return cards.map((key) => {
    const placed = placedRow(entries, key);
    if (placed === null) return null;
    const { item } = placed;
    const isCurrent = key === shown.current;
    return (
      <Root key={key} open={isCurrent}>
        <RowAnchor scroller={scroller} cardKey={key} y={placed.y} h={placed.h} />
        <Portal>
          <Content
            {...PORTAL_SCOPE}
            ref={isCurrent ? card : undefined}
            className="as-card"
            aria-label={item.row.thread.displayTitle}
            side="right"
            align="start"
            sideOffset={10}
            collisionPadding={8}
            sticky="always"
            // why: the card takes no focus as it opens; focus it had goes back as it closes (CardIntent's returnFocus).
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={() => intent.cold()}
            onPointerDownOutside={() => intent.cold()}
            onMouseEnter={() => intent.enterCard()}
            onMouseLeave={(e) => intent.leaveCard(cardKeyAt(e.relatedTarget))}
            onFocus={() => {
              intent.focusCard();
              listFocus.hold(item.key);
            }}
            // why: focus going to a row is reported by the row.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget) && cardKeyAt(e.relatedTarget) === null) intent.blur();
            }}
            onKeyDown={(e) => tabOut(e, listFocus)}
          >
            <CardBody item={item} data={data} onOpen={open} />
          </Content>
        </Portal>
      </Root>
    );
  });
}

// ------------------------------------------------------------------ layer 2

/**
 * The row's box, read each time Radix places the card. A new anchor when the row's place changes, so
 * Radix places the card again; it reads the row where its glide starts, not where it lands. The last
 * box read stands in once the row unmounts.
 */
function RowAnchor({ scroller, cardKey, y, h }: { scroller: RefObject<HTMLElement | null>; cardKey: string; y: number; h: number }) {
  const anchor = useMemo(() => {
    let last = new DOMRect();
    const getBoundingClientRect = () => {
      const row = scroller.current?.querySelector(`[data-card="${CSS.escape(cardKey)}"]`);
      if (row) last = row.getBoundingClientRect();
      return last;
    };
    return { current: { getBoundingClientRect } };
    // why: keyed on the row's place, not its model. A new anchor restarts Floating UI's autoUpdate, which
    // forces style and layout, and the click that opens a row changes its model in the very commit bb
    // lays the opened thread out in.
  }, [scroller, cardKey, y, h]);
  return <Anchor virtualRef={anchor} />;
}

/**
 * One CardIntent for the list, fed by events delegated on the scroller: the pointer over and out of
 * rows; keyboard focus resting on a row as the pointer would, and Tab taking it into the row's card; a
 * press, a right-click or a scroll putting it away cold. While a card shows, the pointer's moves anywhere
 * on the page. No listener and no timer outlives the list.
 */
function useCardIntent(
  scroller: RefObject<HTMLElement | null>,
  card: RefObject<HTMLElement | null>,
  showing: boolean,
  deps: Pick<CardIntentDeps, "onChange" | "returnFocus">,
): CardIntent {
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const [intent] = useState(
    () =>
      new CardIntent({
        probe: () => underPointer(pointer.current),
        cardEdge: () => card.current?.getBoundingClientRect() ?? null,
        ...deps,
      }),
  );

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    // why: a touch has no hover; its tap opens the row, and a card it opened would be left standing.
    const over = (e: PointerEvent) => {
      const key = cardKeyAt(e.target);
      if (key === null || e.pointerType === "touch") return;
      pointer.current = { x: e.clientX, y: e.clientY };
      intent.overRow(key);
    };
    // why: the pointer is not tracked here: an out event already reports the next spot, and the safe
    // triangle starts where the pointer last stood in the row.
    const out = (e: PointerEvent) => {
      const key = cardKeyAt(e.target);
      if (key === null || e.pointerType === "touch" || cardKeyAt(e.relatedTarget) === key || isOnCard(e.relatedTarget)) return;
      intent.leaveRow(key);
    };
    // why: only focus the keyboard moved rests on a row; a click's focus comes with a press, which puts
    // the card away, and holds nothing.
    const focusIn = (e: FocusEvent) => {
      const key = cardKeyAt(e.target);
      if (key === null) return;
      if (e.target instanceof Element && e.target.matches(":focus-visible")) intent.focusRow(key);
      else intent.blur();
    };
    // why: focus moving within its row, to another row, or into the card is reported where it lands.
    const focusOut = (e: FocusEvent) => {
      if (cardKeyAt(e.target) !== null && cardKeyAt(e.relatedTarget) === null && !isOnCard(e.relatedTarget)) intent.blur();
    };
    // why: the card is portaled to the end of the page, so the browser's Tab would skip it.
    const tabIn = (e: KeyboardEvent) => {
      const key = cardKeyAt(e.target);
      if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || key === null || !intent.shows(key)) return;
      const first = card.current === null ? undefined : tabStops(card.current)[0];
      if (first === undefined) return;
      e.preventDefault();
      first.focus();
    };
    const cold = () => intent.cold();

    el.addEventListener("pointerover", over);
    el.addEventListener("pointerout", out);
    el.addEventListener("focusin", focusIn);
    el.addEventListener("focusout", focusOut);
    el.addEventListener("keydown", tabIn);
    el.addEventListener("scroll", cold);
    el.addEventListener("pointerdown", cold, true);
    el.addEventListener("contextmenu", cold, true);
    return () => {
      el.removeEventListener("pointerover", over);
      el.removeEventListener("pointerout", out);
      el.removeEventListener("focusin", focusIn);
      el.removeEventListener("focusout", focusOut);
      el.removeEventListener("keydown", tabIn);
      el.removeEventListener("scroll", cold);
      el.removeEventListener("pointerdown", cold, true);
      el.removeEventListener("contextmenu", cold, true);
      intent.cold();
    };
  }, [scroller, intent]);

  // why: a crossing on its way to the card can end anywhere, the main pane included. Followed over the
  // whole page, as the prototype does, the pointer leaving both the row and the card always lets
  // the card go; followed only over the list, its last spot there stays and the crossed row takes the card.
  useEffect(() => {
    if (!showing) return;
    const move = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      intent.move();
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, [showing, intent]);

  return intent;
}

/**
 * Shift+Tab off the card's first stop lands on its row. Tab off its last goes on from the row, as if
 * the card sat right after it: focus moves to the row and the browser's own Tab carries on from there.
 * Focus can also rest on the card itself (where it goes when an update leaves the body with nothing to
 * show); from there too, with no stop ahead, the keyboard leaves the card the same way.
 */
function tabOut(e: ReactKeyboardEvent<HTMLElement>, listFocus: ListFocus) {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Node)) return;
  const from = e.target;
  const ahead = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  if (tabStops(e.currentTarget).some((stop) => from.compareDocumentPosition(stop) & ahead)) return;
  if (e.shiftKey) e.preventDefault();
  listFocus.refocus();
}

/**
 * Where Tab stops in the card, in order: its body, which scrolls, then the body's buttons (mini rows,
 * "Show all", the plan's folds and Retry). A card with neither plan nor subthreads hides its body.
 */
function tabStops(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>('[tabindex="0"], button')).filter((stop) => stop.checkVisibility());
}

function underPointer(point: Point): Under {
  const el = document.elementFromPoint(point.x, point.y);
  return { point, row: cardKeyAt(el), onCard: isOnCard(el) };
}

/** The key of the row an element is in; null outside rows and in a row being renamed. */
function cardKeyAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || target.closest("[data-editing]") !== null) return null;
  return target.closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
}

/** On the card shown; the 10 between it and its row count as the card (app.css `.as-card::before`). */
function isOnCard(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.as-card[data-state="open"]') !== null;
}

function placedRow(entries: readonly LayoutEntry[], key: string | null): PlacedRow | null {
  if (key === null) return null;
  for (const { item, y, h } of entries) if (item.kind === "row" && cardKeyOf(item) === key) return { item, y, h };
  return null;
}
