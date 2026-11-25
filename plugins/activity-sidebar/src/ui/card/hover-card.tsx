// A list's hover card. CardIntent (src/card/card-intent.ts) decides which row's card shows, fed by
// pointer and focus events delegated on the scroller, and by the pointer's moves anywhere while a card
// shows. Radix Popover (shimmed by the host, so it shares bb's overlay layer) places it beside that row,
// kept inside the window, and closes it on Escape wherever focus is. A card leaving fades out while the
// next fades in. The keyboard reaches it from its row: Tab goes in,
// first to its body, which the arrow keys then scroll, and on through its buttons and links. Shift+Tab
// off its first stop or Escape comes back, and Tab off its last goes on to what follows the list. Focus
// in the card is its row's to the list. What a card says is its list's: the threads' (thread-card.tsx)
// and the managers' (managers/card/manager-card.tsx). A row is found by its `data-card` key.
import { Anchor, Content, Portal, Root } from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { CardIntent, type CardIntentDeps, type Point, type Under } from "../../card/card-intent.ts";
import { PORTAL_SCOPE } from "../portal-scope.ts";

/** The list's keyboard focus, which counts focus in a card as its row's. */
export type ListFocus = {
  /** Focus is on the item under `key`. */
  hold(key: string): void;
  /** Put focus back on the item holding it. */
  refocus(): void;
};

/**
 * A row's card: its accessible name; the list item focus in it counts as; where the row stands (a new
 * place re-anchors the card); and what it says, given the way to put it away (before opening what a
 * press in it names).
 */
export type CardOf = { label: string; focusKey: string; place: string; body(close: () => void): ReactNode };

/**
 * `cardOf`: the card of the row under a key, null once that row is gone. `focusShowsAtOnce`: as
 * CardIntent's. `tracksRow`: the card reads its row's box every frame it shows, and moves as the row
 * moves under it (a manager pinned or unpinned slides the rest); otherwise only a new `place` places it again.
 */
type Props = { scroller: RefObject<HTMLElement | null>; listFocus: ListFocus; cardOf(key: string): CardOf | null; focusShowsAtOnce: boolean; tracksRow: boolean };

/** The card shown, and the one fading out behind it; null, none. */
type Shown = { current: string | null; leaving: string | null };

export function HoverCard({ scroller, listFocus, cardOf, focusShowsAtOnce, tracksRow }: Props) {
  const [shown, setShown] = useState<Shown>({ current: null, leaving: null });
  const card = useRef<HTMLDivElement>(null);
  /** The row whose card a Tab asked to go into before the card was laid out; it goes in as the card is. */
  const entering = useRef<string | null>(null);
  const latestFocus = useRef(listFocus);
  useLayoutEffect(() => {
    latestFocus.current = listFocus;
  });
  const intent = useCardIntent(scroller, card, entering, shown.current !== null, {
    focusShowsAtOnce,
    onChange: (key) => {
      if (entering.current !== key) entering.current = null;
      setShown((was) => ({ current: key, leaving: was.current ?? was.leaving }));
    },
    returnFocus: () => latestFocus.current.refocus(),
  });
  const gone = shown.current !== null && cardOf(shown.current) === null;

  // It goes with its row: filtered out, folded away, moved to another section, archived, deleted. Focus
  // that was in it still counts as there: React turns events off while it commits, so the card's removal
  // reports no blur, and CardIntent hands focus back to the row (or the list's heir for it) as it puts the card away.
  useEffect(() => {
    if (gone) intent.cold();
  }, [gone, intent]);

  // why: a Tab that came while the card was shown but not yet laid out (keyboard focus shows it at once) goes in now.
  const laidOut = (node: HTMLDivElement | null, key: string) => {
    card.current = node;
    if (node === null || entering.current !== key) return;
    entering.current = null;
    (tabStops(node)[0] ?? node).focus();
  };

  // why: one array, so a card keeps its instance (and plays its exit) as it turns from shown to leaving.
  const cards = [shown.leaving, shown.current].filter((key, i, all): key is string => key !== null && all.indexOf(key) === i);
  return cards.map((key) => {
    const what = cardOf(key);
    if (what === null) return null;
    const isCurrent = key === shown.current;
    return (
      <Root key={key} open={isCurrent}>
        <RowAnchor scroller={scroller} cardKey={key} place={what.place} />
        <Portal>
          <Content
            {...PORTAL_SCOPE}
            ref={isCurrent ? (node) => laidOut(node, key) : undefined}
            data-card-of={key}
            className="as-card"
            aria-label={what.label}
            side="right"
            align="start"
            sideOffset={10}
            collisionPadding={8}
            sticky="always"
            updatePositionStrategy={tracksRow ? "always" : "optimized"}
            // why: the card takes no focus as it opens; focus it had goes back as it closes (CardIntent's returnFocus).
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={() => intent.cold()}
            onPointerDownOutside={() => intent.cold()}
            onMouseEnter={() => intent.enterCard()}
            onMouseLeave={(e) => intent.leaveCard(cardKeyAt(e.relatedTarget))}
            onFocus={() => {
              intent.focusCard();
              listFocus.hold(what.focusKey);
            }}
            // why: focus going to a row is reported by the row.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget) && cardKeyAt(e.relatedTarget) === null) intent.blur();
            }}
            onKeyDown={(e) => tabOut(e, listFocus)}
          >
            {what.body(() => intent.cold())}
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
 * box read stands in once the row unmounts. An item side by side with others (a tile in the Managers
 * view's grid) spans its lane (`[data-card-lane]`) across, so its card stands where a row's does,
 * beside the list and level with the item, never over its neighbours.
 */
function RowAnchor({ scroller, cardKey, place }: { scroller: RefObject<HTMLElement | null>; cardKey: string; place: string }) {
  const anchor = useMemo(() => {
    let last = new DOMRect();
    const getBoundingClientRect = () => {
      const row = scroller.current?.querySelector(`[data-card="${CSS.escape(cardKey)}"]`);
      if (row) last = spanned(row);
      return last;
    };
    return { current: { getBoundingClientRect } };
    // why: keyed on the row's place, not its model. A new anchor restarts Floating UI's autoUpdate, which
    // forces style and layout, and the click that opens a row changes its model in the very commit bb
    // lays the opened thread out in.
  }, [scroller, cardKey, place]);
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
  entering: RefObject<string | null>,
  showing: boolean,
  deps: Pick<CardIntentDeps, "focusShowsAtOnce" | "onChange" | "returnFocus">,
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
    // why: the card is portaled to the end of the page, so the browser's Tab would skip it. A card shown
    // but not laid out yet (React renders it after this event) holds the Tab, and takes focus as it is.
    const tabIn = (e: KeyboardEvent) => {
      const key = cardKeyAt(e.target);
      if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || key === null || !intent.shows(key)) return;
      if (card.current?.dataset.cardOf !== key) {
        e.preventDefault();
        entering.current = key;
        return;
      }
      const first = tabStops(card.current)[0];
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
  }, [scroller, intent, card, entering]);

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
 * Where Tab stops in the card, in order: its body, which scrolls, then the body's buttons and links
 * (mini rows, "Show all", the plan's folds and Retry; a manager's issues). A card with nothing under
 * its lines hides its body, or has none.
 */
function tabStops(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>('[tabindex="0"], button, a[href]')).filter((stop) => stop.checkVisibility());
}

/** The item's box, across its lane when it stands in one. */
function spanned(item: Element): DOMRect {
  const box = item.getBoundingClientRect();
  const lane = item.closest("[data-card-lane]")?.getBoundingClientRect();
  return lane === undefined ? box : new DOMRect(lane.left, box.top, lane.width, box.height);
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
