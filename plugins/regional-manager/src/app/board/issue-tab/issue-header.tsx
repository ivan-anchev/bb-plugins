// An issue's head in its tab: its id and kind, its title and its headline, whole, which its row on the
// board fades, then its properties as a labelled sheet (detail/properties.tsx).
// why no sub-issue count or blockers: its relations list each of them (detail/issue-relations.tsx).
import type { IssueFeed, IssueRow } from "../../../contract.ts";
import { PIPELINES } from "../../../model/issue/kind.ts";
import { Properties } from "./detail/properties.tsx";

type IssueHeaderProps = {
  issue: IssueRow;
  /** Every agent that held it, from its feed (null: not read yet). */
  agents: IssueFeed["agents"] | null;
};

export function IssueHeader({ issue, agents }: IssueHeaderProps) {
  return (
    <header className="rmi-issue-head">
      <div className="rmi-issue-meta">
        <span className="rmi-id">{issue.id}</span>
        <span className="rmi-kind">{PIPELINES[issue.kind].label}</span>
      </div>
      <h2 className="rmi-issue-title">{issue.title}</h2>
      {issue.headline !== null && (
        <p className="rmi-issue-headline" data-strong={issue.needsYou !== null || undefined}>
          {issue.headline}
        </p>
      )}
      <Properties issue={issue} agents={agents} />
    </header>
  );
}
