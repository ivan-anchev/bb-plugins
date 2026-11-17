// One issue on the board, Activity Sidebar's tall row (src/ui/row/row.tsx): its status glyph in the
// 30 slot; its id, kind and title fading out; under them its headline. Pressing the row opens its
// detail in place, and the row grows to show its title and headline whole, wrapping. Beside the words, outside the row's button so each is its own control: its pull
// request with CI, and its agent's thread.
import type { Ref } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import { PIPELINES } from "../../../model/issue/kind.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../model/issue/status.ts";
import { FadingText } from "./fading-text.tsx";
import { PrBadge } from "./pr-badge.tsx";
import { StatusGlyph } from "./status-glyph.tsx";
import { ThreadLink } from "./thread-link.tsx";

type IssueRowProps = {
  ref: Ref<HTMLButtonElement>;
  issue: Row;
  open: boolean;
  /** The id of the detail it opens, while open. */
  detailId: string;
  onToggle(): void;
};

export function IssueRow({ ref, issue, open, detailId, onToggle }: IssueRowProps) {
  return (
    <div className="rmi-rowbox" data-open={open || undefined}>
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
            <RowText text={issue.title} whole={open} />
          </span>
          <span className="rmi-headline">
            <RowText text={issue.headline} whole={open} />
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

/** A row's title or headline: whole and wrapping while the row is open, else on one line, fading out at its edge. */
const RowText = ({ text, whole }: { text: string; whole: boolean }) => (whole ? <span className="rmi-whole">{text}</span> : <FadingText text={text} />);

/** Done and Canceled read quieter: nothing is left to do about them. */
const QUIET: ReadonlySet<IssueStatus> = new Set(["done", "canceled"]);

/** "i3 Build: Add the hello note, In review, ✓ Verified: …". */
const spoken = (issue: Row): string => [`${issue.id} ${PIPELINES[issue.kind].label}: ${issue.title}`, STATUS_LABELS[issue.status], issue.headline].join(", ");
