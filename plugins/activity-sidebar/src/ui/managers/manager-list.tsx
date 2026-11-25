// The Managers view: the pinned managers' tiles in a grid at its top, in bb's pin order, then one row a
// regional manager, oldest first, in a scroller that is one tab stop: the arrow keys move between its
// tiles and rows (manager-focus.ts). Few items, so all of them are mounted. Resting on a tile or a row
// shows its card (card/manager-card.tsx), as a thread's row does. Pinning or unpinning one moves it
// between the grid and the list (use-pin-motion.ts).
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { heirOf } from "../../list/focus.ts";
import type { ManagerModel, Managers } from "../../model/activity.ts";
import type { ListFocus } from "../card/hover-card.tsx";
import { usePanelShown } from "../portal-scope.ts";
import { ManagerCard } from "./card/manager-card.tsx";
import { isArrowKey, nextItem } from "./manager-focus.ts";
import { ManagerRow } from "./manager-row.tsx";
import { ManagerTile } from "./manager-tile.tsx";
import { usePinMotion } from "./use-pin-motion.ts";

/** `underWaySince`: since when each thread has worked, for a card's state line; null where no card shows (a compact viewport). */
type Props = { managers: Managers; underWaySince: ReadonlyMap<string, number> | null; onNavigate(): void };

export function ManagerList({ managers, underWaySince, onNavigate }: Props) {
  const shown = usePanelShown();
  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => [...managers.pinned, ...managers.unpinned].map((m) => m.thread.id), [managers]);
  const held = useHeldItem(keys, scroller);
  const listFocus = useListFocus(held, scroller);
  usePinMotion(scroller);

  const item = (manager: ManagerModel, children: ReactNode) => (
    <div
      key={manager.thread.id}
      data-key={manager.thread.id}
      data-card={manager.thread.id}
      onFocus={() => {
        held.current = manager.thread.id;
      }}
    >
      {children}
    </div>
  );

  // why: React bubbles focus through portals, so an item's menu holds focus for its item, as in the threads' list.
  return (
    <div
      ref={scroller}
      className="as-scroller as-managers"
      tabIndex={0}
      aria-label="Managers"
      onKeyDown={moveFocus}
      onFocus={(e) => {
        if (e.target === e.currentTarget) held.current = null;
      }}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) held.current = null;
      }}
    >
      {/* why data-card-lane: a tile's card stands where a row's would, past the grid's right edge, not over the tiles beside it (hover-card.tsx). */}
      {managers.pinned.length > 0 && (
        <div className="as-pins" role="group" aria-label="Pinned" data-card-lane="">
          {managers.pinned.map((manager) => item(manager, <ManagerTile manager={manager} onNavigate={onNavigate} />))}
        </div>
      )}
      {managers.unpinned.map((manager) => item(manager, <ManagerRow manager={manager} onNavigate={onNavigate} />))}
      {/* why: in here, so focus leaving the card (portaled; it adds nothing here) bubbles to onBlur above, as a menu's does.
          Put away while the Managers panel is hidden, as every overlay is (portal-scope.ts). */}
      {underWaySince !== null && shown && <ManagerCard scroller={scroller} managers={managers} underWaySince={underWaySince} listFocus={listFocus} onNavigate={onNavigate} />}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Which item holds focus, by its thread. When it leaves the view (its manager archived or deleted, from
 * its own menu or elsewhere), focus passes to its heir (list/focus.ts), or to the list once none is left.
 * When it moves between the grid and the list (pinned or unpinned from its menu), focus follows it there.
 */
function useHeldItem(keys: readonly string[], scroller: RefObject<HTMLDivElement | null>): RefObject<string | null> {
  const held = useRef<string | null>(null);
  const before = useRef(keys);

  useLayoutEffect(() => {
    const was = before.current;
    before.current = keys;
    const key = held.current;
    if (key === null) return;
    if (keys.includes(key)) {
      // why: its old link went with focus on it (bb's menu hands focus back to it as it closes).
      if (!document.activeElement?.isConnected || document.activeElement === document.body) linkOf(scroller.current, key)?.focus({ preventScroll: true });
      return;
    }
    const heir = heirOf(was, key, new Set(keys));
    held.current = heir;
    const target = heir === null ? scroller.current : linkOf(scroller.current, heir);
    target?.focus({ preventScroll: true });
  }, [keys, scroller]);

  return held;
}

/** The list's focus as its card counts it: focus in a card is its item's, and goes back to that item, or the list once the item is gone. */
function useListFocus(held: RefObject<string | null>, scroller: RefObject<HTMLDivElement | null>): ListFocus {
  return useMemo(
    () => ({
      hold: (key) => {
        held.current = key;
      },
      refocus: () => {
        const key = held.current;
        const item = key === null ? null : linkOf(scroller.current, key);
        (item ?? scroller.current)?.focus({ preventScroll: true });
      },
    }),
    [held, scroller],
  );
}

function linkOf(scroller: HTMLElement | null, key: string): HTMLElement | null {
  return scroller?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] a`) ?? null;
}

/**
 * The arrow keys move between tiles and rows (manager-focus.ts), from the scroller itself to the first.
 * A key another control already handled, or one pressed in a portaled menu (React bubbles it here),
 * belongs to that control.
 */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  if (!isArrowKey(e.key)) return;
  if (e.defaultPrevented || !(e.target instanceof Node && e.currentTarget.contains(e.target))) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>(".as-pin, .as-manager"));
  const grid = e.currentTarget.querySelector<HTMLElement>(".as-pins");
  const at = items.findIndex((item) => item === e.target);
  const next = nextItem(at === -1 ? null : at, e.key, { tiles: grid?.childElementCount ?? 0, columns: grid === null ? 1 : columnsOf(grid), total: items.length });
  if (next === null) return;
  e.preventDefault();
  items[next].focus({ preventScroll: true });
  items[next].scrollIntoView({ block: "nearest" });
}

/** How many columns the grid lays out at its present width (app.css `.as-pins`). */
function columnsOf(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
}
