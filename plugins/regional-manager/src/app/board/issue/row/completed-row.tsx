// The row a parent's Done sub-issues fold behind while the parent isn't Done (sub-issue-tree.tsx):
// a sub-issue's row in its look, with no glyph: "+N completed" starts where the sub-issues' glyphs
// do, quiet as a Done row is. Pressing it unfolds them in place under it, and again
// folds them, the button the parent's count is (pills.tsx), with no chevron drawn.
import { handFocusTo } from "../../../ui/focus-hand-off.ts";

type CompletedRowProps = {
  count: number;
  open: boolean;
  /** The list they unfold in. */
  controls: string;
  onToggle(): void;
};

export function CompletedRow({ count, open, controls, onToggle }: CompletedRowProps) {
  return (
    <div className="rmi-rowbox">
      <button
        ref={focusParentOnLeave}
        type="button"
        className="rmi-row"
        data-quiet
        aria-label={`${count} completed sub-issues`}
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        onClick={onToggle}
      >
        <span className="rmi-row-more">+{count} completed</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/** Focus on the row as it goes (its last Done sub-issue reopened, or was canceled) moves to its parent's row, never to the page body (REVIEW.md). */
const focusParentOnLeave = handFocusTo((row) => row.closest(".rmi-sub-issues")?.previousElementSibling?.querySelector<HTMLElement>(".rmi-row"));
