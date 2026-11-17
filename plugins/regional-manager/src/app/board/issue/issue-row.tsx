// One issue on the board, Activity Sidebar's tall row (src/ui/row/row.tsx): its status glyph in the
// 30 slot; its id, kind and title fading out, a parent's sub-issues done; under them its headline,
// with what blocks it. Pressing the row opens its detail in place. Beside the words, outside the
// row's button so each is its own control: its pull request with CI, and its agent's thread.
import type { Ref } from "react";
import { PIPELINES } from "../../../model/issue/kind.ts";
import { STATUS_LABELS } from "../../../model/issue/status.ts";
import type { BoardIssue } from "./board-issue.ts";
import { FadingText } from "./fading-text.tsx";
import { PrBadge } from "./pr-badge.tsx";
import { StatusGlyph } from "./status-glyph.tsx";
import { ThreadLink } from "./thread-link.tsx";

type IssueRowProps = {
  ref: Ref<HTMLButtonElement>;
  issue: BoardIssue;
  /** 1: a sub-issue, under its parent. */
  depth: 0 | 1;
  open: boolean;
  /** The id of the detail it opens, while open. */
  detailId: string;
  onToggle(): void;
};

export function IssueRow({ ref, issue, depth, open, detailId, onToggle }: IssueRowProps) {
  return (
    <div className="rmi-rowbox" data-open={open || undefined} data-depth={depth || undefined}>
      <button
        ref={ref}
        type="button"
        className="rmi-row"
        data-strong={issue.needsYou !== null || undefined}
        data-quiet={QUIET.has(issue.status) || undefined}
        aria-label={spoken(issue)}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
      >
        <span className="rmi-slot">
          <StatusGlyph status={issue.status} />
        </span>
        <span className="rmi-words">
          <span className="rmi-line">
            <span className="rmi-id">{issue.id}</span>
            <span className="rmi-kind">{PIPELINES[issue.kind].label}</span>
            <FadingText text={issue.title} />
            {issue.subIssues !== null && (
              <span className="rmi-pill">
                {issue.subIssues.done}/{issue.subIssues.total}
              </span>
            )}
          </span>
          <span className="rmi-headline">
            {issue.blockedBy.length > 0 && <span className="rmi-blocked">Blocked by {issue.blockedBy.join(", ")}</span>}
            <FadingText text={issue.headline} />
          </span>
        </span>
      </button>
      {issue.pr !== null && (
        <span className="rmi-pr-cell">
          <PrBadge pr={issue.pr} />
        </span>
      )}
      {issue.agent !== null && (
        <span className="rmi-agent-cell">
          <ThreadLink name={issue.agent.id} threadId={issue.agent.threadId} />
        </span>
      )}
    </div>
  );
}

/** Done and Canceled read quieter: nothing is left to do about them. */
const QUIET: ReadonlySet<BoardIssue["status"]> = new Set(["done", "canceled"]);

/** "i3 Build: Add the hello note, In review, ✓ Verified: …, blocked by i6, 2 of 4 sub-issues done". */
function spoken(issue: BoardIssue): string {
  const bits = [`${issue.id} ${PIPELINES[issue.kind].label}: ${issue.title}`, STATUS_LABELS[issue.status], issue.headline];
  if (issue.blockedBy.length > 0) bits.push(`blocked by ${issue.blockedBy.join(", ")}`);
  if (issue.subIssues !== null) bits.push(`${issue.subIssues.done} of ${issue.subIssues.total} sub-issues done`);
  return bits.join(", ");
}
