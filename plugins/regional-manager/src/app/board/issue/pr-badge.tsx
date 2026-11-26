// An issue's pull request or merge request, Activity Sidebar's badge (src/ui/row/pr-badge.tsx): its
// glyph and number in its state's token on a 10% wash of it (issue-board.css `.rmi-pr`), then a dot
// for CI on its head commit, as the plugin last read them. It links to the change request. A
// GitLab number reads `!41`, as GitLab writes it; GitHub's stays bare, as Activity Sidebar's does.
import type { ReactNode } from "react";
import { FORGE, prRef, type PrSnapshot } from "../../../model/verdict/pr.ts";

type BadgeState = "open" | "draft" | "merged" | "closed";

const CI_NAME: Record<PrSnapshot["ci"], string | null> = { none: null, pending: "CI running", pass: "CI passing", fail: "CI failing", blocked: "CI blocked on a manual job" };

export function PrBadge({ pr }: { pr: PrSnapshot }) {
  const state: BadgeState = pr.state === "open" && pr.draft ? "draft" : pr.state;
  const ci = CI_NAME[pr.ci];
  const noun = FORGE[pr.forge].noun;
  // why the same in its label: a screen reader and a tooltip read the number as the badge shows it.
  const number = pr.forge === "gitlab" ? prRef(pr) : String(pr.number);
  const said = [`${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${number}, ${state}`, ci, pr.failedChecks.length > 0 ? `failed: ${pr.failedChecks.join(", ")}` : null].filter((part) => part !== null).join(", ");
  return (
    <a className="rmi-pr" data-state={state} href={pr.url} target="_blank" rel="noreferrer" title={said} aria-label={said}>
      {GLYPH[state]}
      <span>{number}</span>
      {ci !== null && <i className="rmi-ci" data-ci={pr.ci} aria-hidden />}
    </a>
  );
}

const GLYPH: Record<BadgeState, ReactNode> = {
  open: <PullRequestGlyph />,
  draft: <DraftGlyph />,
  merged: <MergedGlyph />,
  closed: <ClosedGlyph />,
};

/** Zeron's `pull-request` icon at 11. */
function PullRequestGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <path d="M6 7.25v9.5M18 13v3.75" />
      <circle cx="6" cy="5" r="2.25" />
      <circle cx="6" cy="19" r="2.25" />
      <circle cx="18" cy="19" r="2.25" />
      <circle cx="18" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
