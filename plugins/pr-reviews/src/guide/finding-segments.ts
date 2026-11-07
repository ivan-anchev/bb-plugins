// How a step draws findings inside a diff until experimental_Diff takes line annotations: the
// hunk is cut just after each finding's line (after the whole -/+ pair for a removed line, see
// cutAfter), so the step draws code, the finding, then the rest.
import { numberedLines, type Hunk, type NumberedLine } from "../diff/diff-schema.ts";
import { cutAfter, sliceHunk } from "../diff/hunk-patch.ts";
import type { VisibleFinding } from "./walkthrough.ts";

export type Segment = { kind: "code"; hunk: Hunk } | { kind: "finding"; finding: VisibleFinding };

/** The hunk's code with each finding under its line, in line order; findings on one line keep their order. No empty code segment. */
export function interleaveFindings(hunk: Hunk, findings: VisibleFinding[]): Segment[] {
  const segments: Segment[] = [];
  let from = 0;
  for (const { at, finding } of cutsOf(hunk, findings)) {
    if (at > from) segments.push({ kind: "code", hunk: sliceHunk(hunk, from, at) });
    segments.push({ kind: "finding", finding });
    from = at;
  }
  if (from < hunk.lines.length) segments.push({ kind: "code", hunk: sliceHunk(hunk, from, hunk.lines.length) });
  return segments;
}

// Ascending; Array.prototype.sort is stable, so findings on one line stay in submission order.
function cutsOf(hunk: Hunk, findings: VisibleFinding[]) {
  const lines = numberedLines(hunk);
  return findings.map((shown) => ({ at: cutAfter(hunk, lineIndexOf(lines, shown)), finding: shown })).sort((a, b) => a.at - b.at);
}

// why throw: the validator resolved the finding's hunk from this line, so a miss is a storage bug
// that should fail loudly, not a block drawn in the wrong place.
function lineIndexOf(lines: NumberedLine[], { finding }: VisibleFinding): number {
  const index = lines.findIndex((line) => line[finding.side] === finding.line);
  if (index === -1) throw new Error(`The finding "${finding.title}" names ${finding.side} line ${finding.line}, which is not in its hunk`);
  return index;
}
