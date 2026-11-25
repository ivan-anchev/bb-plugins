// An issue's pills: how many of its sub-issues are Done, of those not canceled, what blocks it and
// what it blocks, each a glyph and words on a 10% wash of its token (issue-row.css `.rmi-pill`), as
// the PR badge beside them. Two lengths of the same pills: short on a row ("◔ 3/7", "⊘ 1", "→| 2"),
// a count even for one issue so the row keeps to its line; long in the hover card ("3 of 7 done",
// "Blocked by BBP-6, BBP-7", "Blocks BBP-7, BBP-19"). A parent whose every sub-issue is canceled
// has no count to show, so no count pill. Display only, hidden from a screen reader since the row
// speaks all of it, ids included, in its label; but on a parent's row the count is also the button
// that folds its sub-issues, with no chevron drawn.
import type { ReactNode } from "react";
import type { IssueRow } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { handFocusTo } from "../../../ui/focus-hand-off.ts";

type Length = "short" | "long";

/** What folds a parent's sub-issues under its row: whether they show, the list they show in, and the fold. */
export type SubIssueToggle = { open: boolean; controls: string; onToggle(): void };

type PillsProps = {
  issue: Pick<IssueRow, "subIssues" | "blockedBy" | "blocks">;
  length: Length;
  /** On a parent's row, what its count folds; else null, and the count is display only. */
  toggle: SubIssueToggle | null;
};

export function IssuePills({ issue, length, toggle }: PillsProps) {
  const { subIssues, blockedBy, blocks } = issue;
  return (
    <>
      {blockedBy.length > 0 && (
        <Pill tone="blocked" glyph={<BlockedGlyph />}>
          {length === "short" ? blockedBy.length : <Listed lead="Blocked by" ids={blockedBy} />}
        </Pill>
      )}
      {blocks.length > 0 && (
        <Pill tone="blocking" glyph={<BlockingGlyph />}>
          {length === "short" ? blocks.length : <Listed lead="Blocks" ids={blocks} />}
        </Pill>
      )}
      {subIssues !== null && subIssues.total > 0 && <CountPill count={subIssues} length={length} toggle={toggle} />}
    </>
  );
}

/** Whether the issue shows any pill: the hover card leaves out the line they'd sit on when it doesn't. */
export const hasPills = ({ subIssues, blockedBy, blocks }: PillsProps["issue"]): boolean => (subIssues !== null && subIssues.total > 0) || blockedBy.length > 0 || blocks.length > 0;

// ------------------------------------------------------------------ layer 2

type Tone = "count" | "blocked" | "blocking";

type Count = NonNullable<IssueRow["subIssues"]>;

/** How many sub-issues are Done, of how many; with a toggle, the button that folds them, named for what it folds and stating whether they show. */
function CountPill({ count: { done, total }, length, toggle }: { count: Count; length: Length; toggle: SubIssueToggle | null }) {
  const glyph = <ProgressRing done={done} total={total} />;
  const words = length === "short" ? `${done}/${total}` : `${done} of ${total} done`;
  if (toggle === null) return <Pill tone="count" glyph={glyph}>{words}</Pill>;
  return (
    <button
      ref={focusRowOnLeave}
      type="button"
      className="rmi-pill"
      data-tone="count"
      aria-label={`Sub-issues, ${done} of ${total} done`}
      aria-expanded={toggle.open}
      aria-controls={toggle.open ? toggle.controls : undefined}
      onClick={toggle.onToggle}
    >
      {glyph}
      <span>{words}</span>
    </button>
  );
}

/** Focus on the count as it goes (its last sub-issue not canceled was) moves to its row's button, never to the page body (REVIEW.md). */
const focusRowOnLeave = handFocusTo((pill) => pill.closest(".rmi-rowbox")?.querySelector<HTMLElement>(".rmi-row"));

function Pill({ tone, glyph, children }: { tone: Tone; glyph: ReactNode; children: ReactNode }) {
  return (
    <span className="rmi-pill" data-tone={tone} aria-hidden>
      {glyph}
      <span>{children}</span>
    </span>
  );
}

function Listed({ lead, ids }: { lead: string; ids: readonly IssueId[] }) {
  return (
    <>
      {lead} <span className="rmi-pill-ids">{ids.join(", ")}</span>
    </>
  );
}

/** A ring filling in Done's violet as its sub-issues are Done, on a track in the pill's colour. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden>
      <circle className="rmi-ring-track" cx={6} cy={6} r={4.5} strokeWidth={2} />
      <circle className="rmi-ring-done" cx={6} cy={6} r={4.5} strokeWidth={2} pathLength={total} strokeDasharray={`${done} ${total}`} transform="rotate(-90 6 6)" />
    </svg>
  );
}

/** A circle struck through: something open stands in its way. */
function BlockedGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.7 5.7 12.6 12.6" />
    </svg>
  );
}

/** An arrow into a bar: others wait on it. */
function BlockingGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h12M11 7l5 5-5 5M20 5v14" />
    </svg>
  );
}
