// What a delegate's child rows mean as steps. A step is a bb row (StepRow),
// never a reshaped copy; meaning is derived at the point of use.
import type { StepRow, TimelineRow } from "./bb.ts";

/** The rows a delegate's transcript shows, in order: reasoning included. */
export function transcriptSteps(rows: readonly TimelineRow[]): StepRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" ? transcriptSteps(row.children ?? []) : isTranscriptStep(row) ? [row] : [],
  );
}

/** The steps the strip counts and labels: the transcript without reasoning. */
export function trailSteps(steps: readonly StepRow[]): StepRow[] {
  return steps.filter((row) => !isReasoning(row));
}

/** A step's one-line label: what it ran, read, edited, searched, or fetched, led by that verb; or what it said. */
export function stepLabel(row: StepRow): string {
  switch (row.kind) {
    case "conversation": return firstLine(row.text);
    case "system": return row.title;
    case "work": return workLabel(row);
    default: return unhandled(row);
  }
}

/** The first non-empty line of markdown text, without heading, list, bold, or code marks. */
export function firstLine(text: string): string {
  return text.split("\n").map((line) => line.replace(/^#+\s*|^[-*]\s+|\*\*|`/g, "").trim()).find(Boolean) ?? "";
}

/** The provider's report row: Claude Code's SubagentHandback tool call. */
export function isHandback(row: TimelineRow): row is Extract<TimelineRow, { workKind: "tool" }> {
  return row.kind === "work" && row.workKind === "tool" && row.toolName === "SubagentHandback";
}

// ---------------------------------------------------------------- layer 2

// why: exhaustive, so a work kind a new SDK adds fails to compile here instead of showing its raw kind.
function workLabel(row: Extract<StepRow, { kind: "work" }>): string {
  switch (row.workKind) {
    case "command": return `Ran ${row.command}`;
    case "file-read": return `Read ${row.path}`;
    case "image-view": return `Viewed ${row.path}`;
    case "file-change": return `Edited ${row.change.path}`;
    case "search": return `Searched ${row.query}`;
    case "web-search": return `Searched ${row.queries[0] ?? "the web"}`;
    case "web-fetch": return `Fetched ${row.url}`;
    case "image-generation": return "Generated an image";
    case "plan-steps": return "Updated the plan";
    case "tool": return row.presentation?.title ?? row.toolName;
    case "extension": return row.presentation.title ?? row.presentation.label.completed;
    case "form": return row.title;
    case "approval": return "Asked for approval";
    case "question": return "Asked a question";
    case "delegation":
    case "workflow": return `Started ${row.description ?? "a subagent"}`;
    default: return unhandled(row);
  }
}

/**
 * `never` keeps the switches exhaustive at compile time. At runtime the bb host
 * can be newer than the pinned SDK, so a kind it adds reads as its title, or
 * "Working", and never takes the strip down.
 */
function unhandled(row: never): string {
  return presentationTitle(row) ?? "Working";
}

function presentationTitle(row: unknown): string | null {
  if (typeof row !== "object" || row === null || !("presentation" in row)) return null;
  const { presentation } = row;
  if (typeof presentation !== "object" || presentation === null || !("title" in presentation)) return null;
  return typeof presentation.title === "string" ? presentation.title : null;
}

function isTranscriptStep(row: TimelineRow): boolean {
  if (isHandback(row)) return false; // it is the report, shown as the outcome
  return !(row.kind === "work" && row.workKind === "delegation"); // nesting is ignored
}

function isReasoning(row: StepRow): boolean {
  return row.kind === "system" && row.systemKind === "operation" && row.operationKind === "reasoning";
}
