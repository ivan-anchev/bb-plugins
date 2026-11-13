// A row's pull request, Zeron's badge (Z:ds/session_row.luau:285-306): its glyph and number in its
// state's ink on a 10% wash of it, legible on every row surface in light and dark (app.css `.as-pr`);
// its state and title a tooltip.
import type { PullRequest } from "../../data/pull-request/github-pr-status.ts";

/** Zeron's state names (Z:ds/locale_en.luau:328-331). */
const PR_STATE_NAME: Record<PullRequest["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

export function PrBadge({ pr }: { pr: PullRequest }) {
  return (
    <span className="as-pr" data-state={pr.state} title={`${PR_STATE_NAME[pr.state]} · ${pr.title}`} aria-hidden>
      {pr.state === "draft" ? <DraftGlyph /> : <PullRequestGlyph />}
      <span>{pr.number}</span>
    </span>
  );
}

/** Zeron's `pull-request` icon at 11. */
function PullRequestGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.5v7M18 15.5V8.25a2 2 0 0 0-2-2h-3.5m2.25-2.25L12.5 6.25l2.25 2.25" />
      <circle cx="6" cy="6.25" r="2.25" />
      <circle cx="6" cy="17.75" r="2.25" />
      <circle cx="18" cy="17.75" r="2.25" />
    </svg>
  );
}

/** Zeron's `pull-request-draft` icon at 11. */
function DraftGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M6 7.25v9.5M18 13v3.75" />
      <circle cx="6" cy="5" r="2.25" />
      <circle cx="6" cy="19" r="2.25" />
      <circle cx="18" cy="19" r="2.25" />
      <circle cx="18" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
