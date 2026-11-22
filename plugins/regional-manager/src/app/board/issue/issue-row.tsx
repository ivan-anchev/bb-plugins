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

const NAMED_BLOCKERS = 2;

const QUIET: ReadonlySet<IssueStatus> = new Set(["done", "canceled"]);

const spoken = (issue: Row): string =>
  [
    `${issue.id} ${PIPELINES[issue.kind].label}: ${issue.title}`,
    ...(issue.parentId === null ? [] : [`sub-issue of ${issue.parentId}`]),
    STATUS_LABELS[issue.status],
    ...(issue.subIssues === null ? [] : [`${issue.subIssues.done} of ${issue.subIssues.total} sub-issues done`]),
    ...blockedText(issue.blockedBy),
    ...(issue.headline === null ? [] : [issue.headline]),
  ].join(", ");

const blockedText = (ids: readonly IssueId[]): string[] => (ids.length === 0 ? [] : [`blocked by ${new Intl.ListFormat("en", { type: "conjunction" }).format(ids)}`]);
