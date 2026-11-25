// The Managers view: one row a regional manager, oldest first, in a scroller that is one tab stop,
// ↑/↓ moving between its rows as in the threads' list. Few rows, so all of them are mounted. Resting on
// a row shows its card (manager-card.tsx), as a thread's row does.
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import { heirOf } from "../../list/focus.ts";
import type { ManagerModel } from "../../model/activity.ts";
import type { ListFocus } from "../card/hover-card.tsx";
import { usePanelShown } from "../portal-scope.ts";
import { ManagerCard } from "./manager-card.tsx";
import { ManagerRow } from "./manager-row.tsx";

/** `underWaySince`: since when each thread has worked, for a card's state line; null where no card shows (a compact viewport). */
type Props = { managers: readonly ManagerModel[]; underWaySince: ReadonlyMap<string, number> | null; onNavigate(): void };

export function ManagerList({ managers, underWaySince, onNavigate }: Props) {
  const shown = usePanelShown();
  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => managers.map((m) => m.thread.id), [managers]);
  const held = useHeldRow(keys, scroller);
  const listFocus = useListFocus(held, scroller);

  // why: React bubbles focus through portals, so a row's menu holds focus for its row, as in the threads' list.
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
      {managers.map((manager) => (
        <div
          key={manager.thread.id}
          data-key={manager.thread.id}
          data-card={manager.thread.id}
          onFocus={() => {
            held.current = manager.thread.id;
          }}
        >
          <ManagerRow manager={manager} onNavigate={onNavigate} />
        </div>
      ))}
      {/* why: in here, so focus leaving the card (portaled; it adds nothing here) bubbles to onBlur above, as a menu's does.
          Put away while the Managers panel is hidden, as every overlay is (portal-scope.ts). */}
      {underWaySince !== null && shown && <ManagerCard scroller={scroller} managers={managers} underWaySince={underWaySince} listFocus={listFocus} onNavigate={onNavigate} />}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Which row holds focus, by its thread. When that row leaves the list (its manager archived or deleted,
 * from its own menu or elsewhere), focus passes to its heir (list/focus.ts), or to the list once none is left.
 */
function useHeldRow(keys: readonly string[], scroller: RefObject<HTMLDivElement | null>): RefObject<string | null> {
  const held = useRef<string | null>(null);
  const before = useRef(keys);

  useLayoutEffect(() => {
    const was = before.current;
    before.current = keys;
    const key = held.current;
    if (key === null || keys.includes(key)) return;
    const heir = heirOf(was, key, new Set(keys));
    held.current = heir;
    const rows = Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-key]") ?? []);
    const target = heir === null ? scroller.current : rows.find((row) => row.dataset.key === heir)?.querySelector<HTMLElement>("a");
    target?.focus({ preventScroll: true });
  }, [keys, scroller]);

  return held;
}

/** The list's focus as its card counts it: focus in a card is its row's, and goes back to that row, or the list once the row is gone. */
function useListFocus(held: RefObject<string | null>, scroller: RefObject<HTMLDivElement | null>): ListFocus {
  return useMemo(
    () => ({
      hold: (key) => {
        held.current = key;
      },
      refocus: () => {
        const key = held.current;
        const row = key === null ? null : scroller.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] a`);
        (row ?? scroller.current)?.focus({ preventScroll: true });
      },
    }),
    [held, scroller],
  );
}

/**
 * ↑/↓ move to the next or previous row, from the scroller itself to the first. A key another control
 * already handled, or one pressed in a portaled menu (React bubbles it here), belongs to that control.
 */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.defaultPrevented || !(e.target instanceof Node && e.currentTarget.contains(e.target))) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>(".as-manager"));
  if (rows.length === 0) return;
  e.preventDefault();
  const at = rows.findIndex((row) => row === e.target);
  const next = at === -1 ? rows[0] : rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest" });
}
