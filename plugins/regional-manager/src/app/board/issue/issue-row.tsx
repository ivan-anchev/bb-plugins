// One issue on the board, Activity Sidebar's tall row (src/ui/row/row.tsx): its status glyph in the
// 30 slot; its id, kind and title fading out; under them what blocks it and its headline, if anything:
// with neither, as for a parent whose count says it all, the row is its one line. Pressing the row opens the
// issue's own tab beside the Board, or focuses it (issue-tab/open-issue.ts), which shows its title and
// headline whole. Beside the words, outside the row's button so each is its own control: its pull
// request with CI, and its agent's thread; a parent, which never has either, counts its sub-issues
// Done on its first line instead, where it stays whether a headline comes or goes. A sub-issue's row
// away from its parent names the parent ahead of its id.
import type { Ref } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { PIPELINES } from "../../../model/issue/kind.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../model/issue/status.ts";
import { useOpenIssue } from "../issue-tab/open-issue.ts";
import { FadingText } from "./fading-text.tsx";
import { PrBadge } from "./pr-badge.tsx";
import { StatusGlyph } from "./status-glyph.tsx";
import { ThreadLink } from "./thread-link.tsx";

type IssueRowProps = {
  ref: Ref<HTMLButtonElement>;
  issue: Row;
  /** The parent it is named under, for a sub-issue's row away from its parent (under Needs you); else null. */
  under: IssueId | null;
};

export function IssueRow({ ref, issue, under }: IssueRowProps) {
  const open = useOpenIssue();
  const secondLine = issue.blockedBy.length > 0 || issue.headline !== null;
  return (
    <div className="rmi-rowbox" data-one-line={!secondLine || undefined}>
      <button
        ref={ref}
        type="button"
        className="rmi-row"
        data-strong={issue.needsYou !== null || undefined}
        data-quiet={QUIET.has(issue.status) || undefined}
        aria-label={spoken(issue)}
        onClick={() => open(issue)}
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
            <FadingText text={issue.title} />
          </span>
          {secondLine && (
            <span className="rmi-headline">
              {issue.blockedBy.length > 0 && <Blockers ids={issue.blockedBy} />}
              {issue.headline !== null && <FadingText text={issue.headline} />}
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

/**
 * What blocks the issue, ahead of its headline: "blocked by BBP-6", the first two named and the rest
 * counted ("blocked by BBP-6, BBP-7 +2") so it keeps to its line; its tab lists them all. why lower case,
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
 * "BBP-3 Build: Add the hello note, In review, ✓ Verified: …"; "BBP-4 Build: Retry queue, Todo, blocked by
 * BBP-2 and BBP-3, Not started"; "BBP-1 Build: Card vault, In progress, 1 of 3 sub-issues done";
 * "BBP-5 Build: Vault schema, sub-issue of BBP-1, In progress, Blocked: …". why a sub-issue names its parent
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
