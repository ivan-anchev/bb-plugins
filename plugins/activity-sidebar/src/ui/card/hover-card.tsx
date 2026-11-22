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

type PlacedRow = { item: RowItem; y: number; h: number };

type Props = { scroller: RefObject<HTMLElement | null>; entries: readonly LayoutEntry[]; data: CardData; listFocus: ListFocus; onNavigate(): void };

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

  useEffect(() => {
    if (shown.current !== null && current === null) intent.cold();
  }, [shown.current, current, intent]);

  const open = (threadId: string) => {
    intent.cold();
    navigate.toThread(threadId);
    onNavigate();
  };

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

function RowAnchor({ scroller, cardKey, y, h }: { scroller: RefObject<HTMLElement | null>; cardKey: string; y: number; h: number }) {
  const anchor = useMemo(() => {
    let last = new DOMRect();
    const getBoundingClientRect = () => {
      const row = scroller.current?.querySelector(`[data-card="${CSS.escape(cardKey)}"]`);
      if (row) last = row.getBoundingClientRect();
      return last;
    };
    return { current: { getBoundingClientRect } };
  }, [scroller, cardKey, y, h]);
  return <Anchor virtualRef={anchor} />;
}

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
    const over = (e: PointerEvent) => {
      const key = cardKeyAt(e.target);
      if (key === null || e.pointerType === "touch") return;
      pointer.current = { x: e.clientX, y: e.clientY };
      intent.overRow(key);
    };
    const out = (e: PointerEvent) => {
      const key = cardKeyAt(e.target);
      if (key === null || e.pointerType === "touch" || cardKeyAt(e.relatedTarget) === key || isOnCard(e.relatedTarget)) return;
      intent.leaveRow(key);
    };
    const focusIn = (e: FocusEvent) => {
      const key = cardKeyAt(e.target);
      if (key === null) return;
      if (e.target instanceof Element && e.target.matches(":focus-visible")) intent.focusRow(key);
      else intent.blur();
    };
    const focusOut = (e: FocusEvent) => {
      if (cardKeyAt(e.target) !== null && cardKeyAt(e.relatedTarget) === null && !isOnCard(e.relatedTarget)) intent.blur();
    };
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

function tabOut(e: ReactKeyboardEvent<HTMLElement>, listFocus: ListFocus) {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Node)) return;
  const from = e.target;
  const ahead = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  if (tabStops(e.currentTarget).some((stop) => from.compareDocumentPosition(stop) & ahead)) return;
  if (e.shiftKey) e.preventDefault();
  listFocus.refocus();
}

function tabStops(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>('[tabindex="0"], button')).filter((stop) => stop.checkVisibility());
}

function underPointer(point: Point): Under {
  const el = document.elementFromPoint(point.x, point.y);
  return { point, row: cardKeyAt(el), onCard: isOnCard(el) };
}

function cardKeyAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || target.closest("[data-editing]") !== null) return null;
  return target.closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
}

function isOnCard(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.as-card[data-state="open"]') !== null;
}

function placedRow(entries: readonly LayoutEntry[], key: string | null): PlacedRow | null {
  if (key === null) return null;
  for (const { item, y, h } of entries) if (item.kind === "row" && cardKeyOf(item) === key) return { item, y, h };
  return null;
}
