// An issue's glyph on a manager's card, as the Board draws it (the Regional Manager plugin's
// status-glyph.tsx, copied: a plugin imports nothing from another), 12 in the mini line's slot, in its
// status's token (app.css `.as-issue-state`). The open stages fill one ring clockwise from 12 o'clock
// as the issue moves on: Todo empty, In progress a quarter, Reviewing three eighths, Verifying a half,
// In review three quarters; Done closes on its check. Backlog's ring is dotted, Canceled's crossed.
// Needs you's mark stands in for the status of an issue waiting on the user.
import type { ReactNode } from "react";
import type { IssueStatus } from "../../model/manager-issues.ts";

/** What the glyph shows: an issue's status, or that it waits on the user. */
export type IssueMark = IssueStatus | "needs-you";

// why aria-hidden: the line's accessible name says the status in words.
export function IssueGlyph({ mark }: { mark: IssueMark }) {
  return (
    <span className="as-issue-state" data-state={mark} aria-hidden>
      {glyph(mark)}
    </span>
  );
}

// ------------------------------------------------------------------ layer 2

function glyph(mark: IssueMark): ReactNode {
  switch (mark) {
    case "needs-you":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </Icon>
      );
    case "backlog":
      // why dots: not planned yet reads apart from the stages' solid ring.
      return (
        <Icon>
          <circle cx="12" cy="12" r="9" strokeWidth={2.25} strokeDasharray="0.01 4.71" />
        </Icon>
      );
    case "todo":
      return <Stage fill={null} />;
    case "in-progress":
      return <Stage fill={QUARTER} />;
    case "reviewing":
      return <Stage fill={THREE_EIGHTHS} />;
    case "verifying":
      return <Stage fill={HALF} />;
    case "in-review":
      return <Stage fill={THREE_QUARTERS} />;
    case "done":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </Icon>
      );
    case "canceled":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6M9 9l6 6" />
        </Icon>
      );
    default:
      return mark satisfies never;
  }
}

/** An open stage's ring, filled from 12 o'clock clockwise by `fill`, a pie inside the ring with a gap to it (null: empty). */
function Stage({ fill }: { fill: string | null }) {
  return (
    <Icon>
      <circle cx="12" cy="12" r="10" />
      {fill !== null && <path d={fill} fill="currentColor" stroke="none" />}
    </Icon>
  );
}

/** The pie's slices, radius 6 about the ring's centre: to 3, half past 4, 6 and 9 o'clock. */
const QUARTER = "M12 12V6a6 6 0 0 1 6 6z";
const THREE_EIGHTHS = "M12 12V6a6 6 0 0 1 4.243 10.243z";
const HALF = "M12 6a6 6 0 0 1 0 12z";
const THREE_QUARTERS = "M12 12V6a6 6 0 1 1-6 6z";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
