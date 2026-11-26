// One issue on the board, Activity Sidebar's one-line row (src/ui/row/row.tsx): its status glyph in
// the 30 slot, or Needs you's while it waits on the user; its id in mono, in a column the ids share;
// its title fading out; then its pills and its pull request. Under Needs you alone a second line
// carries what it waits on the user for, as that is what the user acts on; everywhere else the
// headline is the hover card's (hover-card/), and the issue's own tab's. Pressing the row opens the
// issue's tab beside the Board, or focuses it (`onOpen`). Its pull request sits
// outside the row's button, its own control, and so does a parent's count of its sub-issues, which
// folds them (pills.tsx). A sub-issue's row away from its parent names the parent ahead of its id.
import "./issue-row.css";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import type { IssueRow as Row } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../../model/issue/status.ts";
import { PrBadge } from "../pr-badge.tsx";
import { IssueGlyph } from "../status-glyph.tsx";
import { FadingText } from "./fading-text.tsx";
import { IssuePills, type SubIssueToggle } from "./pills.tsx";

type IssueRowProps = {
  ref: Ref<HTMLButtonElement>;
  issue: Row;
  /** The parent it is named under, for a sub-issue's row away from its parent (under Needs you); else null. */
  under: IssueId | null;
  /** What it waits on the user for, shown under its title (under Needs you); else null. */
  ask: string | null;
  /** On a parent's row with sub-issues under it, what its count folds; else null. */
  toggle: SubIssueToggle | null;
  /** Opens the issue's tab, as pressing the row does. */
  onOpen(): void;
  /** The pointer and focus events that open and close its hover card, on the whole row. */
  hover: HTMLAttributes<HTMLDivElement>;
  /** Its hover card, while it shows. */
  children?: ReactNode;
};

export function IssueRow({ ref, issue, under, ask, toggle, onOpen, hover, children }: IssueRowProps) {
  return (
    <div className="rmi-rowbox" data-asks={ask !== null || undefined} {...hover}>
      <button
        ref={ref}
        type="button"
        className="rmi-row"
        data-strong={issue.needsYou !== null || undefined}
        data-quiet={QUIET.has(issue.status) || undefined}
        aria-label={spoken(issue)}
        onClick={onOpen}
      >
        <span className="rmi-slot"><IssueGlyph issue={issue} /></span>
        <span className="rmi-row-id">
          {under !== null && (
            <>
              {under}
              <span className="rmi-crumb">›</span>
            </>
          )}
          {issue.id}
        </span>
        <FadingText text={issue.title} />
        {ask !== null && (
          <span className="rmi-ask">
            <FadingText text={ask} />
          </span>
        )}
      </button>
      <span className="rmi-meta">
        <IssuePills issue={issue} length="short" toggle={toggle} />
        {issue.pr !== null && <PrBadge pr={issue.pr} />}
      </span>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/** Done and Canceled read quieter: nothing is left to do about them. */
const QUIET: ReadonlySet<IssueStatus> = new Set(["done", "canceled"]);

/**
 * "BBP-3: Add the hello note, In review, ✓ Verified: …"; "BBP-4: Retry queue, Todo, blocked by BBP-2
 * and BBP-3, Not started"; "BBP-1: Card vault, In progress, 1 of 3 sub-issues done, blocks BBP-9";
 * "BBP-5: Vault schema, sub-issue of BBP-1, In progress, needs you: Blocked: …". why a sub-issue names
 * its parent under it too: a reader who tabs or lists buttons straight to it hears no nesting. why
 * every pill and the headline: the hover card that shows them is the pointer's and the eye's.
 */
const spoken = (issue: Row): string =>
  [
    `${issue.id}: ${issue.title}`,
    ...(issue.parentId === null ? [] : [`sub-issue of ${issue.parentId}`]),
    STATUS_LABELS[issue.status],
    ...(issue.needsYou === null ? [] : [`needs you: ${issue.needsYou}`]),
    ...(issue.subIssues === null || issue.subIssues.total === 0 ? [] : [`${issue.subIssues.done} of ${issue.subIssues.total} sub-issues done`]),
    ...listed("blocked by", issue.blockedBy),
    ...listed("blocks", issue.blocks),
    ...(issue.headline === null || issue.headline === issue.needsYou ? [] : [issue.headline]),
  ].join(", ");

/** The issues after `lead`, spoken as a list ("blocks BBP-7 and BBP-19"); nothing when there are none. */
const listed = (lead: string, ids: readonly IssueId[]): string[] => (ids.length === 0 ? [] : [`${lead} ${new Intl.ListFormat("en", { type: "conjunction" }).format(ids)}`]);
