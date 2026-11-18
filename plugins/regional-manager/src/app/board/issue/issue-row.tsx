// One issue on the board, Activity Sidebar's tall row (src/ui/row/row.tsx): its status glyph in the
// 30 slot; its id, kind and title fading out; under them what blocks it and its headline, if anything:
// with neither, as for a parent whose count says it all, the row is its one line. Pressing the row opens its
// detail in place, and the row grows to show its title and headline whole, wrapping. Beside the words, outside the row's button so each is its own control: its pull
// request with CI, and its agent's thread; a parent, which never has either, counts its sub-issues
// Done on its first line instead, where it stays whether a headline comes or goes. A sub-issue's row
// away from its parent names the parent ahead of its id.
import type { Ref } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { PIPELINES } from "../../../model/issue/kind.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../model/issue/status.ts";
import { FadingText } from "./fading-text.tsx";
import { PrBadge } from "./pr-badge.tsx";
import { StatusGlyph } from "./status-glyph.tsx";
import { ThreadLink } from "./thread-link.tsx";

type IssueRowProps = {
  ref: Ref<HTMLButtonElement>;
  issue: Row;
  /** The parent it is named under, for a sub-issue's row away from its parent (under Needs you); else null. */
  under: IssueId | null;
  open: boolean;
  /** The id of the detail it opens, while open. */
  detailId: string;
  onToggle(): void;
};

export function IssueRow({ ref, issue, under, open, detailId, onToggle }: IssueRowProps) {
  const secondLine = issue.blockedBy.length > 0 || issue.headline !== null;
  return (
    <div className="rmi-rowbox" data-open={open || undefined} data-one-line={!secondLine || undefined}>
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
            <span className="rmi-id">
              {under !== null && (
                <>
                  {under}
                  <span className="rmi-crumb">›</span>
                </>
              )}
              {issue.id}
            </span>
            <span className="rmi-kind">{PIPELINES[issue.kind].label}</span>
            <RowText text={issue.title} whole={open} />
          </span>
          {secondLine && (
            <span className="rmi-headline">
              {issue.blockedBy.length > 0 && <Blockers ids={issue.blockedBy} />}
              {issue.headline !== null && <RowText text={issue.headline} whole={open} />}
            </span>
          )}
        </span>
      </button>
      {issue.pr !== null && (
        <span className="rmi-pr-cell">
          <PrBadge pr={issue.pr} />
        </span>
      )}
      {issue.subIssues !== null ? (
        <span className="rmi-count-cell" aria-hidden>
          {issue.subIssues.done}/{issue.subIssues.total}
        </span>
      ) : (
        issue.agent !== null && (
          <span className="rmi-agent-cell">
            <ThreadLink name={issue.agent.id} threadId={issue.agent.threadId} />
          </span>
        )
      )}
    </div>
  );
}

/** A row's title or headline: whole and wrapping while the row is open, else on one line, fading out at its edge. */
const RowText = ({ text, whole }: { text: string; whole: boolean }) => (whole ? <span className="rmi-whole">{text}</span> : <FadingText text={text} />);

/**
 * What blocks the issue, ahead of its headline: "blocked by i6", the first two named and the rest
 * counted ("blocked by i6, i7 +2") so it keeps to its line; its detail lists them all. why lower case,
 * its ids set as the row's own: it is a fact about the plan, unlike an agent's "Blocked: …"
 * headline, the agent's words asking the user for something.
 */
function Blockers({ ids }: { ids: readonly IssueId[] }) {
  const named = ids.slice(0, NAMED_BLOCKERS);
  const more = ids.length - named.length;
  return (
    <span className="rmi-blocked">
      blocked by <span className="rmi-blocked-ids">{named.join(", ")}</span>
      {more > 0 && <span className="rmi-blocked-ids"> +{more}</span>}
    </span>
  );
}

/** How many blockers a row names before it counts the rest. */
const NAMED_BLOCKERS = 2;

/** Done and Canceled read quieter: nothing is left to do about them. */
const QUIET: ReadonlySet<IssueStatus> = new Set(["done", "canceled"]);

/**
 * "i3 Build: Add the hello note, In review, ✓ Verified: …"; "i4 Build: Retry queue, Todo, blocked by
 * i2 and i3, Not started"; "i1 Build: Card vault, In progress, 1 of 3 sub-issues done";
 * "i5 Build: Vault schema, sub-issue of i1, In progress, Blocked: …". why a sub-issue names its parent
 * under it too: a reader who tabs or lists buttons straight to it hears no nesting.
 */
const spoken = (issue: Row): string =>
  [
    `${issue.id} ${PIPELINES[issue.kind].label}: ${issue.title}`,
    ...(issue.parentId === null ? [] : [`sub-issue of ${issue.parentId}`]),
    STATUS_LABELS[issue.status],
    ...(issue.subIssues === null ? [] : [`${issue.subIssues.done} of ${issue.subIssues.total} sub-issues done`]),
    ...blockedText(issue.blockedBy),
    ...(issue.headline === null ? [] : [issue.headline]),
  ].join(", ");

/** Every blocker, spoken: none when nothing blocks it. */
const blockedText = (ids: readonly IssueId[]): string[] => (ids.length === 0 ? [] : [`blocked by ${new Intl.ListFormat("en", { type: "conjunction" }).format(ids)}`]);
