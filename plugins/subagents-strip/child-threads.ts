// bb child threads of the current thread as canonical delegates. A child is a
// real bb thread, so nothing here is a provider quirk: its status is the
// thread's, its steps are its own timeline's rows, its report its closing
// message, its tool calls its work rows, its tokens its latest token-usage
// event, and the parent turn it belongs to is read off the parent's rows.
import type { ChildThread, EventRow, InterruptRow, StepRow, TimelineRow, TurnRow } from "./bb.ts";
import type { Delegate, DelegateId, DelegateState, DelegateStatus } from "./delegate.ts";
import { childSteps, splitReport } from "./steps.ts";
import { conceptOf } from "./work-label.ts";

/**
 * The children the source reads and watches: those spawned inside the loaded
 * parent timeline, plus any still running. A bound like the parent's segment
 * limit, not a scope rule: selectRoster still decides what shows.
 */
export function childrenInView(children: readonly ChildThread[], parentRows: readonly TimelineRow[]): ChildThread[] {
  return children.filter((child) => spawningTurn(child, parentRows) !== null || threadRunning(child));
}

/** Whether a child thread is working or about to: any status but idle or error. */
export function threadRunning(child: ChildThread): boolean {
  return liveStatus(child.status) === "running";
}

/** What the source reads of a child itself: its own timeline rows, and its total tokens (null before it has a figure). */
export type ChildRead = { rows: readonly TimelineRow[]; totalTokens: number | null };

/** The event a child's tokens come from: bb records one per provider call, its `total` cumulative. */
export const TOKEN_USAGE_EVENT = "thread/tokenUsage/updated" satisfies EventRow["type"];

/** A child's total tokens from its latest token-usage event; null when it has none yet. */
export function totalTokensOf(latest: EventRow | undefined): number | null {
  return latest?.type === TOKEN_USAGE_EVENT ? latest.data.tokenUsage.total.totalTokens : null;
}

/** One child thread as a delegate, from its list row, what was read of it, and the parent's rows. */
export function childDelegate(child: ChildThread, { rows, totalTokens }: ChildRead, parentRows: readonly TimelineRow[]): Delegate {
  const { state, steps } = settle(child, rows);
  return {
    id: child.id as DelegateId, // a child thread's brand point: its thread id
    origin: { kind: "child-thread", threadId: child.id },
    providerId: child.providerId,
    turnId: spawningTurn(child, parentRows),
    title: child.title ?? child.titleFallback ?? "Untitled thread",
    startedAt: child.createdAt,
    steps,
    // why: bb's chat compacts a thread's timeline open, and each settled turn's group closed inside it (`as`, `is`).
    scopes: [{ rows, closed: false }],
    usage: { toolUses: steps.filter(isToolCall).length, totalTokens },
    state,
  };
}

// ---------------------------------------------------------------- layer 2

/** The parent turn under way when the child was created: the turnId of the last parent row that had started by then. */
// why: a running turn is not grouped yet (its rows come back flat, each with its turnId), so any row counts, not only turn rows.
function spawningTurn(child: ChildThread, parentRows: readonly TimelineRow[]): string | null {
  return parentRows.findLast((row) => row.turnId !== null && row.startedAt <= child.createdAt)?.turnId ?? null;
}

/** Status from the thread; which way it ended, when, and the report from its own rows. */
function settle(child: ChildThread, rows: readonly TimelineRow[]): { state: DelegateState; steps: readonly StepRow[] } {
  const steps = childSteps(rows).filter(isOwnStep);
  const end = latestTurnEnd(rows);
  // why: a settled turn's completedAt is when the child finished (it equals the thread's updatedAt on
  // every live child read); updatedAt covers a thread that failed before any turn, or a turn left ungrouped.
  const endedAt = end?.completedAt ?? child.updatedAt;
  const status = outcome(liveStatus(child.status), end);
  switch (status) {
    case "running": return { state: { status }, steps };
    case "completed": {
      const split = splitReport(steps);
      return { state: { status, endedAt, report: split.report }, steps: split.steps };
    }
    case "failed": return { state: { status, endedAt, error: lastError(steps) }, steps };
    case "stopped": return { state: { status, endedAt }, steps };
  }
}

type LiveStatus = "running" | "idle" | "error";

function liveStatus(status: ChildThread["status"]): LiveStatus {
  switch (status) {
    case "pending":
    case "starting":
    case "active":
    case "stopping": return "running";
    case "idle": return "idle";
    case "error": return "error";
    default: return unhandledStatus(status);
  }
}

/**
 * The row that closed the child's latest turn: its turn group, or the "Stopped manually" row.
 * why: bb groups a turn that did work, and only such a turn; an interrupted one leaves the stop row
 * instead (live, after `bb thread stop`). A stop row before the latest turn began closed an earlier
 * turn: the child was told something since. With neither, the turn did no work to group (a plain reply).
 */
function latestTurnEnd(rows: readonly TimelineRow[]): TurnEnd | undefined {
  const latest = rows.findLast((row) => row.turnId !== null)?.turnId;
  const began = latest === undefined ? -1 : rows.findIndex((row) => row.turnId === latest);
  const stop = rows.findLast(isInterrupt);
  if (stop && rows.indexOf(stop) > began) return stop;
  return rows.find((row): row is TurnRow => row.kind === "turn" && row.turnId === latest);
}

/** An idle thread ended the way its latest turn did; one that left no end row has nothing left to do. */
function outcome(live: LiveStatus, end: TurnEnd | undefined): DelegateStatus {
  switch (live) {
    case "running": return "running";
    case "error": return "failed";
    case "idle": return !end ? "completed" : end.kind === "turn" ? TURN_OUTCOME[end.status] : "stopped";
  }
}

// why: an idle thread whose last turn never closed did not finish its work, so it reads stopped.
const TURN_OUTCOME: Record<TurnRow["status"], DelegateStatus> = {
  completed: "completed", error: "failed", interrupted: "stopped", pending: "stopped",
};

// ---------------------------------------------------------------- layer 3

// why: the brief, and any later message to the child, is what it was asked, not what it did.
const isOwnStep = (row: StepRow): boolean => !(row.kind === "conversation" && row.role === "user");

// why: a call is work bb's chat tallies (conceptOf, exhaustive over workKind). Approvals, questions, and forms are
// interactions (an interactionId, no callId), an approval on a call already counted, and bb tallies no workflow.
// A delegation counts, as Claude Code counts its Agent call among a task's tool uses.
const isToolCall = (row: StepRow): boolean => row.kind === "work" && conceptOf(row) !== null;

type TurnEnd = TurnRow | InterruptRow;

const isInterrupt = (row: TimelineRow): row is InterruptRow =>
  row.kind === "system" && row.systemKind === "operation" && row.operationKind === "thread-interrupted";

/**
 * The last error bb recorded in the child's timeline: an error row, or a step of the thread's own
 * that failed, as provisioning does when its workspace cannot be set up (no turn, no error row).
 */
function lastError(steps: readonly StepRow[]): string | null {
  const row = steps.findLast((step) => step.kind === "system" && (step.systemKind === "error" || step.status === "error"));
  return row?.kind === "system" ? row.title : null;
}

/**
 * `never` keeps the switch exhaustive at compile time. At runtime the bb host
 * can be newer than the pinned SDK, so a status it adds reads as running until
 * the thread goes idle or errors, and never takes the strip down.
 */
function unhandledStatus(_status: never): LiveStatus {
  return "running";
}
