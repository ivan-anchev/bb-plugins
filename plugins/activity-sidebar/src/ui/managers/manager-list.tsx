// The Managers view: one row a regional manager, oldest first, in a scroller that is one tab stop,
// ↑/↓ moving between its rows as in the threads' list. Few rows, so all of them are mounted.
import type { KeyboardEvent } from "react";
import type { ManagerModel } from "../../model/activity.ts";
import { ManagerRow } from "./manager-row.tsx";

export function ManagerList({ managers, onNavigate }: { managers: readonly ManagerModel[]; onNavigate(): void }) {
  return (
    <div className="as-scroller as-managers" tabIndex={0} aria-label="Managers" onKeyDown={moveFocus}>
      {managers.map((manager) => (
        <ManagerRow key={manager.thread.id} manager={manager} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

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
