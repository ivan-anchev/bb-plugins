// The Managers view: one row a regional manager, oldest first, in a scroller that is one tab stop,
// ↑/↓ moving between its rows as in the threads' list. Few rows, so all of them are mounted.
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import { heirOf } from "../../list/focus.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { ManagerRow } from "./manager-row.tsx";

export function ManagerList({ managers, onNavigate }: { managers: readonly ManagerModel[]; onNavigate(): void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => managers.map((m) => m.thread.id), [managers]);
  const held = useHeldRow(keys, scroller);

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
          onFocus={() => {
            held.current = manager.thread.id;
          }}
        >
          <ManagerRow manager={manager} onNavigate={onNavigate} />
        </div>
      ))}
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
