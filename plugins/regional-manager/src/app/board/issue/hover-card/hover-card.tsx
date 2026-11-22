// A row's hover card (use-hover-card.ts says when it shows), Activity Sidebar's card under the row
// (src/ui/card/card-body.tsx): the issue's title whole, up to three lines; its status, and its agent;
// what it waits on the user for, or else its headline, which the row leaves out; its pills spelled
// out; and its sub-issues, or what blocks it and what it blocks, each the other issue's glyph, id
// and title. Display only, and hidden from a screen reader: the row's label speaks all of it, and
// pressing the row opens the issue's tab, which holds the rest.
import "./hover-card.css";
import type { IssueRow as Row } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { FadingText } from "../row/fading-text.tsx";
import { IssuePills } from "../row/pills.tsx";
import { NeedsYouGlyph, StatusGlyph } from "../status-glyph.tsx";

type HoverCardProps = {
  issue: Row;
  /** Every issue on the board, which its sub-issues and blockers are. */
  issues: readonly Row[];
};

export function HoverCard({ issue, issues }: HoverCardProps) {
  const pick = (ids: readonly IssueId[]) => issues.filter(({ id }) => ids.includes(id));
  return (
    <div className="rmi-card" aria-hidden>
      <p className="rmi-card-title">{issue.title}</p>
      <p className="rmi-card-when">
        {STATUS_LABELS[issue.status]}
        {issue.agent !== null && ` · ${issue.agent.id}`}
      </p>
      {issue.needsYou === null ? (
        issue.headline !== null && <p className="rmi-card-headline">{issue.headline}</p>
      ) : (
        <div className="rmi-card-ask">
          <p className="rmi-card-asks">Needs you</p>
          <p className="rmi-card-headline">{issue.needsYou}</p>
        </div>
      )}
      {(issue.subIssues !== null || issue.blockedBy.length > 0 || issue.blocks.length > 0) && (
        <div className="rmi-card-facts">
          <IssuePills issue={issue} length="long" />
        </div>
      )}
      <Related title="Sub-issues" rows={issues.filter(({ parentId }) => parentId === issue.id)} />
      <Related title="Blocked by" rows={pick(issue.blockedBy)} />
      <Related title="Blocks" rows={pick(issue.blocks)} />
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/** A section of related issues, each a small line of its row; none when there are none. */
function Related({ title, rows }: { title: string; rows: readonly Row[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rmi-card-section">
      <p className="rmi-card-section-title">{title}</p>
      {rows.map((row) => (
        <div key={row.id} className="rmi-card-line">
          {row.needsYou === null ? <StatusGlyph status={row.status} still /> : <NeedsYouGlyph />}
          <span className="rmi-card-id">{row.id}</span>
          <FadingText text={row.title} />
        </div>
      ))}
    </div>
  );
}
