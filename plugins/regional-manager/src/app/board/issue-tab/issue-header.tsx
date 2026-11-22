// An issue's head in its tab, what its row on the board shows given room: its status, id and kind,
// then its pull request with CI and its agent's thread; under them its title and its headline, whole.
// why no sub-issue count or blockers: its relations list each of them (detail/issue-relations.tsx).
import type { IssueRow } from "../../../contract.ts";
import { PIPELINES } from "../../../model/issue/kind.ts";
import { STATUS_LABELS } from "../../../model/issue/status.ts";
import { PrBadge } from "../issue/pr-badge.tsx";
import { StatusGlyph } from "../issue/status-glyph.tsx";
import { ThreadLink } from "../issue/thread-link.tsx";

export function IssueHeader({ issue }: { issue: IssueRow }) {
  return (
    <header className="rmi-issue-head">
      <div className="rmi-issue-meta">
        <StatusGlyph status={issue.status} />
        {/* why hidden: the glyph speaks the status already. */}
        <span className="rmi-issue-status" aria-hidden>
          {STATUS_LABELS[issue.status]}
        </span>
        <span className="rmi-id">{issue.id}</span>
        <span className="rmi-kind">{PIPELINES[issue.kind].label}</span>
        <span className="rmi-issue-links">
          {issue.pr !== null && <PrBadge pr={issue.pr} />}
          {issue.agent !== null && <ThreadLink name={issue.agent.id} threadId={issue.agent.threadId} />}
        </span>
      </div>
      <h2 className="rmi-issue-title">{issue.title}</h2>
      {issue.headline !== null && (
        <p className="rmi-issue-headline" data-strong={issue.needsYou !== null || undefined}>
          {issue.headline}
        </p>
      )}
    </header>
  );
}
