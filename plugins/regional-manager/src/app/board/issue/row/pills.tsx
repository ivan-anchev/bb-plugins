// An issue's pills: how many of its sub-issues are Done, what blocks it and what it blocks, each a
// glyph and words on a 10% wash of its token (issue-row.css `.rmi-pill`), as the PR badge beside
// them. Two lengths of the same pills: short on a row ("◔ 3/7", "⊘ 1", "→| 2"), a count even for one
// issue so the row keeps to its line; long in the hover card ("3 of 7 done", "Blocked by BBP-6,
// BBP-7", "Blocks BBP-7, BBP-19"). Display only: the row speaks all of it, ids included, in its
// label, so the pills are hidden from a screen reader.
import type { ReactNode } from "react";
import type { IssueRow } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";

type Length = "short" | "long";

type PillsProps = { issue: Pick<IssueRow, "subIssues" | "blockedBy" | "blocks">; length: Length };

export function IssuePills({ issue: { subIssues, blockedBy, blocks }, length }: PillsProps) {
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
      {subIssues !== null && (
        <Pill tone="count" glyph={<ProgressRing done={subIssues.done} total={subIssues.total} />}>
          {length === "short" ? `${subIssues.done}/${subIssues.total}` : `${subIssues.done} of ${subIssues.total} done`}
        </Pill>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

type Tone = "count" | "blocked" | "blocking";

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
