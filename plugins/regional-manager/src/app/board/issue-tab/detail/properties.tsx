// An issue's properties in its head, as a labelled sheet: its status, its pull request with CI when
// it has one, and its assignees, every agent that held it (assignees.tsx). why no Assignee on a
// parent: a parent never holds an agent, and its sub-issues' agents are theirs, in their own tabs.
import type { IssueFeed, IssueRow } from "../../../../contract.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { PrBadge } from "../../issue/pr-badge.tsx";
import { StatusGlyph } from "../../issue/status-glyph.tsx";
import { Assignees } from "./assignees.tsx";

type PropertiesProps = {
  issue: IssueRow;
  /** Every agent that held it, from its feed (null: not read yet). */
  agents: IssueFeed["agents"] | null;
};

export function Properties({ issue, agents }: PropertiesProps) {
  const parent = issue.subIssues !== null;
  return (
    <dl className="rmi-properties">
      <dt>Status</dt>
      <dd>
        <StatusGlyph status={issue.status} />
        {/* why hidden: the glyph speaks the status already. */}
        <span className="rmi-properties-status" aria-hidden>
          {STATUS_LABELS[issue.status]}
        </span>
      </dd>
      {issue.pr !== null && (
        <>
          <dt>Pull request</dt>
          <dd>
            <PrBadge pr={issue.pr} />
          </dd>
        </>
      )}
      {!parent && (
        <>
          <dt>Assignee</dt>
          <dd>{agents !== null && <Assignees agents={agents} />}</dd>
        </>
      )}
    </dl>
  );
}
