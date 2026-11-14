// A row's pull request, Zeron's badge: its glyph and number in its
// state's ink on a 10% wash of it, legible on every row surface in light and dark (app.css `.as-pr`);
// its state and title a tooltip.
import type { ReactNode } from "react";
import type { PullRequest } from "../../data/pull-request/github-pr-status.ts";

/** Zeron's state names. */
const PR_STATE_NAME: Record<PullRequest["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

/** Each state's glyph, as Zeron's PR badge picks its icon (Z:ds/badge.luau:328-333). */
const PR_STATE_GLYPH: Record<PullRequest["state"], ReactNode> = {
  open: <PullRequestGlyph />,
  draft: <DraftGlyph />,
  merged: <MergedGlyph />,
  closed: <ClosedGlyph />,
};

export function PrBadge({ pr }: { pr: PullRequest }) {
  return (
    <span className="as-pr" data-state={pr.state} title={`${PR_STATE_NAME[pr.state]} · ${pr.title}`} aria-hidden>
      {PR_STATE_GLYPH[pr.state]}
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

/** Zeron's `git-merge` icon at 11. */
function MergedGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.5v7M6 8.5c0 4.5 3.5 7.75 9.75 9.25" />
      <circle cx="6" cy="6.25" r="2.25" />
      <circle cx="6" cy="17.75" r="2.25" />
      <circle cx="18" cy="17.75" r="2.25" />
    </svg>
  );
}

/** Zeron's `pull-request-closed` icon at 11. */
function ClosedGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.5v7M18 15.5v-3.25M16 4.25l4 4M20 4.25l-4 4" />
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
