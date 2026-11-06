// The one place provider quirks live: bb's delegation rows plus background-task
// events become canonical delegates. Nothing else in the plugin reads `output`,
// `childRef`, `toolArgs`, or task events. `background` is never read: Claude
// Code agents run async whatever it says.
import type { BackgroundTaskItem, DelegationRow, EventRow, StepRow, TaskStatus, TimelineRow } from "./bb.ts";
import type { Delegate, DelegateId, DelegateState, DelegateStatus, StepScope } from "./delegate.ts";
import { childSteps, isHandback, splitReport } from "./steps.ts";

/** Latest background-task snapshot per delegation callId (the task's `parentToolCallId`). */
export type TaskLedger = ReadonlyMap<string, TaskSnapshot>;
type TaskSnapshot = Pick<BackgroundTaskItem, "taskStatus" | "usage" | "error"> & { at: number };

/** The event types a source must request to follow every task's lifecycle. */
export const TASK_EVENT_TYPES = [
  // why: opens a task as "running"; most agents emit no progress event at all.
  "item/started",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
] as const satisfies readonly EventRow["type"][];

export function foldTaskEvents(ledger: TaskLedger, events: readonly EventRow[]): TaskLedger {
  const next = new Map(ledger);
  for (const event of events) {
    const task = backgroundTaskOf(event);
    if (!task?.parentToolCallId) continue;
    // why: events arrive in seq order, so the last write is the latest state.
    // Usage is cumulative, and starts and some progress events carry none: keep the last known.
    const usage = task.usage ?? next.get(task.parentToolCallId)?.usage;
    next.set(task.parentToolCallId, { taskStatus: task.taskStatus, usage, error: task.error, at: event.createdAt });
  }
  return next;
}

/** The thread's delegation rows as delegates; `providerId` is the thread's, which runs them all. */
export function normalise(rows: readonly TimelineRow[], ledger: TaskLedger, providerId: string): Delegate[] {
  return groupByChild(topLevelDelegations(rows)).map((group) => toDelegate(group, ledger, providerId));
}

// ---------------------------------------------------------------- layer 2

function toDelegate(group: readonly [DelegationRow, ...DelegationRow[]], ledger: TaskLedger, providerId: string): Delegate {
  const first = group[0];
  const task = taskFor(group, ledger);
  const childRows = concatChildRows(group);
  const settled = task ? stateFromTask(task, childRows) : stateFromRow(group[group.length - 1], childRows);
  const { state, steps } = reportFromSteps(settled, childRows && childSteps(childRows));
  return {
    id: first.callId as DelegateId, // a delegation's brand point: its first callId
    origin: { kind: "delegation" },
    providerId,
    turnId: first.turnId,
    title: titleOf(first),
    startedAt: first.startedAt,
    steps,
    scopes: group.flatMap(scopeOf),
    usage: task?.usage ?? null,
    state,
  };
}

function stateFromTask(task: TaskSnapshot, childRows: readonly TimelineRow[] | null): DelegateState {
  const status = TASK_STATUS[task.taskStatus];
  switch (status) {
    case "running": return { status };
    // why: a row that ran as a task carries a launch receipt as `output`, never the report.
    case "completed": return { status, endedAt: task.at, report: handbackReport(childRows) };
    case "failed": return { status, endedAt: task.at, error: nonEmpty(task.error) };
    case "stopped": return { status, endedAt: task.at };
  }
}

function stateFromRow(row: DelegationRow, childRows: readonly TimelineRow[] | null): DelegateState {
  const status = ROW_STATUS[row.status];
  // why: bb stamps completedAt when it settles a row, interrupting included, and none of the 104
  // settled rows across 65 local Claude Code threads lacks it; startedAt only satisfies the type.
  const endedAt = row.completedAt ?? row.startedAt;
  switch (status) {
    case "running": return { status };
    case "completed": return { status, endedAt, report: handbackReport(childRows) ?? nonEmpty(row.output) };
    case "failed": return { status, endedAt, error: nonEmpty(row.output) };
    case "stopped": return { status, endedAt };
  }
}

/**
 * A completed delegate with no handback and no output reports its last
 * assistant message, which then leaves its steps. Codex sends neither: output
 * is "" on all 6 captured rows, and each ends in its closing message.
 */
// why: keyed on the data, not the provider: Claude Code agents hand back, so it never fires for them.
function reportFromSteps(
  state: DelegateState,
  steps: readonly StepRow[] | null,
): { state: DelegateState; steps: readonly StepRow[] | null } {
  if (state.status !== "completed" || state.report !== null || steps === null) return { state, steps };
  const split = splitReport(steps);
  return { state: { ...state, report: split.report }, steps: split.steps };
}

// why: paused counts as live; killed and stopped merge into one "stopped" (TaskStop sends killed, then stopped).
const TASK_STATUS: Record<TaskStatus, DelegateStatus> = {
  pending: "running", running: "running", paused: "running",
  completed: "completed", failed: "failed", killed: "stopped", stopped: "stopped",
};
const ROW_STATUS: Record<DelegationRow["status"], DelegateStatus> = {
  pending: "running", completed: "completed", error: "failed", interrupted: "stopped",
};

// ---------------------------------------------------------------- layer 3

/** Delegation rows at the top level and inside turn groups, never inside a delegate's own children. */
function topLevelDelegations(rows: readonly TimelineRow[]): DelegationRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" ? topLevelDelegations(row.children ?? [])
    : row.kind === "work" && row.workKind === "delegation" ? [row]
    : [],
  );
}

/** One delegate per child: Codex writes a row per collab call on the same childRef; Claude's childRef is unique per row. */
function groupByChild(rows: readonly DelegationRow[]): [DelegationRow, ...DelegationRow[]][] {
  const groups = new Map<string, [DelegationRow, ...DelegationRow[]]>();
  for (const row of rows) {
    const key = row.childRef ?? row.callId;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()]; // a Map keeps first-seen order, which is start order
}

function taskFor(group: readonly DelegationRow[], ledger: TaskLedger): TaskSnapshot | undefined {
  return group.map((row) => ledger.get(row.callId)).findLast((task) => task !== undefined);
}

// why: bb's chat compacts each delegation row's child rows apart, closed once the row settles (`rs`):
// the row's status, not the task's, so a Claude Code agent that runs on folds closed, as bb's chat shows it.
function scopeOf(row: DelegationRow): StepScope[] {
  return row.childRows ? [{ rows: row.childRows, closed: row.status !== "pending" }] : [];
}

function concatChildRows(group: readonly DelegationRow[]): TimelineRow[] | null {
  const lists = group.flatMap((row) => (row.childRows ? [row.childRows] : []));
  return lists.length > 0 ? lists.flat() : null;
}

/** The report is the last handback's `message` argument. */
function handbackReport(childRows: readonly TimelineRow[] | null): string | null {
  const message = childRows?.findLast(isHandback)?.toolArgs?.message;
  // why: toolArgs is untyped provider JSON; this is its boundary.
  return typeof message === "string" ? nonEmpty(message) : null;
}

function titleOf(row: DelegationRow): string {
  return agentName(nonEmpty(row.description) ?? nonEmpty(row.presentation?.title) ?? nonEmpty(row.subagentType) ?? "Subagent");
}

/** Codex names an agent by its path ("/root/counter_e"); the last segment is its name. */
// why: only a whitespace-free absolute path matches, so a free-text description is never cut.
function agentName(title: string): string {
  return AGENT_PATH.exec(title)?.[1] ?? title;
}
const AGENT_PATH = /^\/(?:[^/\s]+\/)*([^/\s]+)$/;

function backgroundTaskOf(event: EventRow): BackgroundTaskItem | null {
  switch (event.type) {
    case "item/started":
      return event.data.item.type === "backgroundTask" ? event.data.item : null;
    case "item/backgroundTask/progress":
    case "item/backgroundTask/completed":
      return event.data.item;
    default:
      return null;
  }
}

const nonEmpty = (text: string | null | undefined): string | null => (text?.trim() ? text : null);
