// What a delegate's child rows mean as steps. A step is a bb row (StepRow),
// never a reshaped copy; meaning is derived at the point of use.
import type { ActivityIntent, AssistantRow, ReasoningRow, StepRow, TimelineRow, WorkRow } from "./bb.ts";

/**
 * A delegate's rows as its steps, in order, turn groups flattened. Every row bb's chat
 * shows stays, the handback and nested delegations included, so the trail's work
 * groups count what bb's count ("ran 1 tool" for the handback, "ran 1 subagent").
 */
export function childSteps(rows: readonly TimelineRow[]): StepRow[] {
  return rows.flatMap((row) => (row.kind === "turn" ? childSteps(row.children ?? []) : [row]));
}

/** The steps the transcript shows: all but the handback, which it shows as the outcome. */
export function transcriptSteps(steps: readonly StepRow[]): StepRow[] {
  return steps.filter((row) => !isHandback(row));
}

/** The steps the strip counts and labels: the transcript without reasoning. */
export function trailSteps(steps: readonly StepRow[]): StepRow[] {
  return transcriptSteps(steps).filter((row) => !isReasoning(row));
}

/**
 * A step's one-line label: what it ran, read, edited, searched, or fetched, led by that verb,
 * in the present tense while the step runs ("Running …") and the past once it ends ("Ran …"); or what it said.
 */
export function stepLabel(row: StepRow): string {
  switch (row.kind) {
    case "conversation": return firstLine(row.text);
    case "system": return row.title;
    case "work": return workLabel(row);
    default: return unhandled(row);
  }
}

/** What a step did, as the trail's kind icon shows it. */
export type StepKind = "command" | "read" | "edit" | "search" | "web" | "tool" | "message" | "note";

export function stepKind(row: StepRow): StepKind {
  switch (row.kind) {
    case "conversation": return "message";
    case "system": return "note";
    case "work": return workStepKind(row);
    default: return unhandledKind(row);
  }
}

/** A work step that ended in error, or a command that exited non-zero. */
export function stepFailed(row: StepRow): boolean {
  if (row.kind !== "work") return false;
  return row.status === "error" || (row.workKind === "command" && row.exitCode !== null && row.exitCode !== 0);
}

/** The first non-empty line of markdown text, without heading, list, bold, or code marks. */
export function firstLine(text: string): string {
  return text.split("\n").map((line) => line.replace(/^#+\s*|^[-*]\s+|\*\*|`/g, "").trim()).find(Boolean) ?? "";
}

/** The provider's report row: Claude Code's SubagentHandback tool call. */
export function isHandback(row: TimelineRow): row is Extract<TimelineRow, { workKind: "tool" }> {
  return row.kind === "work" && row.workKind === "tool" && row.toolName === "SubagentHandback";
}

/**
 * A finished delegate's report when its provider hands none back: its last
 * non-blank assistant message, which leaves the steps so the row and the
 * transcript show it once, as the outcome (as transcriptSteps hides the handback).
 */
export function splitReport(steps: readonly StepRow[]): { steps: readonly StepRow[]; report: string | null } {
  const message = steps.findLast(isReportMessage);
  if (!message) return { steps, report: null };
  return { steps: steps.filter((row) => row !== message), report: message.text };
}

/** A reasoning row: the transcript shows it as a collapsed Thinking block; the trail leaves it out. */
export function isReasoning(row: StepRow): row is ReasoningRow {
  return row.kind === "system" && row.systemKind === "operation" && row.operationKind === "reasoning";
}

/**
 * What a step reads, lists, or searches, as bb reads it (`mo`): a command's activity intents, or a
 * read or search as the intent a command would carry for it. Other work carries none.
 */
export function stepIntents(row: WorkRow): readonly ActivityIntent[] {
  switch (row.workKind) {
    case "command": return row.activityIntents;
    case "file-read": return [{ type: "read", command: row.cmd ?? row.path, name: "fileRead", path: row.path }];
    case "search":
      return row.mode === "content"
        ? [{ type: "search", command: row.cmd ?? row.query, query: row.query, path: row.path }]
        : [{ type: "list_files", command: row.cmd ?? row.query, path: row.path ?? (row.query.length > 0 ? row.query : null) }];
    case "file-change":
    case "image-view":
    case "image-generation":
    case "web-search":
    case "web-fetch":
    case "plan-steps":
    case "tool":
    case "extension":
    case "form":
    case "approval":
    case "question":
    case "delegation":
    case "workflow": return [];
    default: return unhandledIntents(row);
  }
}

/** bb's `vo`: a read, a search, or a command bb reads as one; bb's chat counts these as exploring. */
export function isExploration(row: WorkRow): boolean {
  return stepIntents(row).some((intent) => intent.type !== "unknown");
}

// ---------------------------------------------------------------- layer 2

// why: exhaustive, so a work kind a new SDK adds fails to compile here instead of showing its raw kind.
function workLabel(row: WorkRow): string {
  const verb = (running: string, ran: string): string => (isLive(row) ? running : ran);
  switch (row.workKind) {
    case "command": return `${verb("Running", "Ran")} ${row.command}`;
    case "file-read": return `${verb("Reading", "Read")} ${row.path}`;
    case "image-view": return `${verb("Viewing", "Viewed")} ${row.path}`;
    case "file-change": return `${verb("Editing", "Edited")} ${row.change.path}`;
    case "search": return `${verb("Searching", "Searched")} ${row.query}`;
    case "web-search": return `${verb("Searching", "Searched")} ${row.queries[0] ?? "the web"}`;
    case "web-fetch": return `${verb("Fetching", "Fetched")} ${row.url}`;
    case "image-generation": return verb("Generating an image", "Generated an image");
    case "plan-steps": return verb("Updating the plan", "Updated the plan");
    case "tool": return row.presentation?.title ?? row.toolName;
    case "extension": return row.presentation.title ?? row.presentation.label.completed;
    case "form": return row.title;
    case "approval": return verb("Asking for approval", "Asked for approval");
    case "question": return verb("Asking a question", "Asked a question");
    case "delegation":
    case "workflow": return `${verb("Starting", "Started")} ${row.description ?? "a subagent"}`;
    default: return unhandled(row);
  }
}

// why: exhaustive, so a status a new SDK adds fails to compile here; at runtime it reads as finished.
function isLive(row: WorkRow): boolean {
  switch (row.status) {
    case "pending": return true;
    case "completed":
    case "error":
    case "interrupted": return false;
    default: return unhandledStatus(row.status);
  }
}

function workStepKind(row: WorkRow): StepKind {
  switch (row.workKind) {
    case "command": return "command";
    case "file-read":
    case "image-view": return "read";
    case "file-change": return "edit";
    case "search": return "search";
    case "web-search":
    case "web-fetch": return "web";
    case "approval":
    case "question":
    case "form": return "message";
    case "plan-steps": return "note";
    case "tool":
    case "extension":
    case "image-generation":
    case "delegation":
    case "workflow": return "tool";
    default: return unhandledKind(row);
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

/** As `unhandled`: a kind a newer host adds shows the generic tool icon. */
function unhandledKind(_row: never): StepKind {
  return "tool";
}

/** As `unhandled`: a work kind a newer host adds reads, lists, and searches nothing. */
function unhandledIntents(_row: never): readonly ActivityIntent[] {
  return [];
}

/** As `unhandled`: a status a newer host adds reads in the past tense, as every step did before tenses. */
function unhandledStatus(_status: never): boolean {
  return false;
}

function presentationTitle(row: unknown): string | null {
  if (typeof row !== "object" || row === null || !("presentation" in row)) return null;
  const { presentation } = row;
  if (typeof presentation !== "object" || presentation === null || !("title" in presentation)) return null;
  return typeof presentation.title === "string" ? presentation.title : null;
}

// why: a blank message cannot be a report; the one before it can.
function isReportMessage(row: StepRow): row is AssistantRow {
  return row.kind === "conversation" && row.role === "assistant" && row.text.trim() !== "";
}

