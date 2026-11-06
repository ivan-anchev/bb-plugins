// What a delegate's child rows mean as steps. A step is a bb TimelineRow, never
// a reshaped copy; meaning is derived at the point of use.
import type { TimelineRow } from "./bb.ts";

/** The rows a delegate's transcript shows, in order: reasoning included. */
export function transcriptSteps(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" ? transcriptSteps(row.children ?? []) : isTranscriptStep(row) ? [row] : [],
  );
}

/** The steps the strip counts and labels: the transcript without reasoning. */
export function trailSteps(steps: readonly TimelineRow[]): TimelineRow[] {
  return steps.filter((row) => !isReasoning(row));
}

/** The provider's report row: Claude Code's SubagentHandback tool call. */
export function isHandback(row: TimelineRow): row is Extract<TimelineRow, { workKind: "tool" }> {
  return row.kind === "work" && row.workKind === "tool" && row.toolName === "SubagentHandback";
}

// ---------------------------------------------------------------- layer 2

function isTranscriptStep(row: TimelineRow): boolean {
  if (isHandback(row)) return false; // it is the report, shown as the outcome
  return !(row.kind === "work" && row.workKind === "delegation"); // nesting is ignored
}

function isReasoning(row: TimelineRow): boolean {
  return row.kind === "system" && row.systemKind === "operation" && row.operationKind === "reasoning";
}
