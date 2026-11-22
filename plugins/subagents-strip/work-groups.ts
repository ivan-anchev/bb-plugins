import type { ActivityIntent, ReasoningRow, StepRow, TimelineRow, WorkRow } from "./bb.ts";
import type { Delegate } from "./delegate.ts";
import { isRunning, plural } from "./roster.ts";
import { isReasoning, stepIntents, trailSteps, transcriptSteps } from "./steps.ts";
import { isThreadTell } from "./thread-tell.ts";
import { conceptOf, groupLabel, type Concept } from "./work-label.ts";

/** One line of the trail or the transcript: a single step, or a run of steps folded into what they did. */
export type WorkItem =
  | { kind: "step"; step: StepRow; live: boolean }
  | {
      kind: "group";
      id: string;
      /** bb's words: "Explored 3 files, ran 2 commands", "Running 2 commands" while live. */
      label: string;
      /** "2 errors", "1 interrupted", or both; null when every step ended well. */
      note: string | null;
      live: boolean;
      steps: readonly StepRow[];
    };

/** A delegate's trail: its lines without reasoning, the handback, the report, or a child's own brief. */
export function trailItems(d: Delegate): WorkItem[] {
  return workItems(d, trailSteps(d.steps ?? []));
}

/** A delegate's transcript: the same lines with reasoning in them, as bb's chat shows it; the rest still leaves. */
export function transcriptItems(d: Delegate): WorkItem[] {
  return workItems(d, transcriptSteps(d.steps ?? []));
}

function workItems(d: Delegate, visible: readonly StepRow[]): WorkItem[] {
  const scopes = d.scopes.map(({ rows, closed }) => compact(rows, closed));
  const live = isRunning(d) ? liveUnit(scopes.at(-1) ?? []) : null;
  const shown = new Set(visible.map((row) => row.id));
  return scopes.flat().flatMap((unit) => lines(unit, live, shown));
}

type GroupRow = WorkRow | ReasoningRow;

type Unit =
  | { kind: "step"; step: StepRow }
  | { kind: "group"; fold: Fold; rows: readonly GroupRow[] }
  | { kind: "turn"; units: readonly Unit[] };

type Fold = "open" | "closed-at-message" | "closed-with-scope";

function compact(rows: readonly TimelineRow[], closed: boolean): Unit[] {
  const units: Unit[] = [];
  let run: GroupRow[] = [];
  for (const row of rows) {
    if (isGroupable(row)) {
      run.push(row);
      continue;
    }
    const line: Unit = row.kind === "turn" ? { kind: "turn", units: compact(row.children ?? [], true) } : { kind: "step", step: row };
    units.push(...(isBoundary(row) ? foldClosed(run, "closed-at-message") : foldOpen(run)), line);
    run = [];
  }
  units.push(...(closed ? foldClosed(run, "closed-with-scope") : foldOpen(run)));
  return units;
}

function liveUnit(units: readonly Unit[]): Unit | null {
  const latest = units.findLast((unit) => !(unit.kind === "step" && isUserMessage(unit.step)));
  if (!latest) return null;
  switch (latest.kind) {
    case "step": return latest;
    case "group": return latest.fold === "closed-at-message" ? null : latest;
    case "turn": return null;
  }
}

function lines(unit: Unit, live: Unit | null, shown: ReadonlySet<string>): WorkItem[] {
  switch (unit.kind) {
    case "step": return shown.has(unit.step.id) ? [{ kind: "step", step: unit.step, live: unit === live }] : [];
    case "group": {
      const { rows } = unit;
      const steps = rows.filter((row) => shown.has(row.id));
      if (steps.length === 0) return [];
      const isLive = unit === live;
      return [{ kind: "group", id: `${rows[0].id}:group`, label: groupLabel(rows.filter(isWork), isLive), note: failureNote(rows), live: isLive, steps }];
    }
    case "turn": return unit.units.flatMap((inner) => lines(inner, live, shown));
  }
}

function foldClosed(run: readonly GroupRow[], fold: Exclude<Fold, "open">): Unit[] {
  if (run.length < 2 || !run.some(isWork)) return run.map(asStep);
  return [{ kind: "group", fold, rows: dedupe(run) }];
}

function foldOpen(run: readonly GroupRow[]): Unit[] {
  const chunks: { concept: Concept; rows: GroupRow[] }[] = [];
  let leading: GroupRow[] = [];
  for (const row of run) {
    const last = chunks.at(-1);
    if (row.kind === "system") {
      if (last) last.rows.push(row);
      else leading.push(row);
      continue;
    }
    const concept = conceptOf(row) ?? "tools";
    if (last?.concept === concept) last.rows.push(row);
    else {
      chunks.push({ concept, rows: [...leading, row] });
      leading = [];
    }
  }
  return [...leading.map(asStep), ...chunks.map(({ rows }): Unit => (rows.length === 1 ? asStep(rows[0]) : { kind: "group", fold: "open", rows: dedupe(rows) }))];
}

function dedupe(rows: readonly GroupRow[]): GroupRow[] {
  let previous: string | null = null;
  const kept: GroupRow[] = [];
  for (const row of rows) {
    const all = row.kind === "system" ? [] : stepIntents(row);
    if (all.length === 0) {
      previous = null;
      kept.push(row);
      continue;
    }
    const intents = all.filter((intent) => {
      const key = intentKey(intent);
      if (key !== null && key === previous) return false;
      if (key !== null) previous = key;
      return true;
    });
    if (intents.length === all.length) kept.push(row);
    else if (row.kind === "work" && row.workKind === "command" && intents.some((intent) => intent.type !== "unknown")) kept.push({ ...row, activityIntents: intents });
  }
  return kept;
}

function failureNote(rows: readonly GroupRow[]): string | null {
  const errors = rows.filter((row) => row.status === "error").length;
  const interrupted = rows.filter((row) => row.status === "interrupted").length;
  const parts = [errors > 0 ? plural(errors, "error") : null, interrupted > 0 ? `${interrupted} interrupted` : null];
  return parts.filter((part) => part !== null).join(", ") || null;
}

function isGroupable(row: TimelineRow): row is GroupRow {
  if (row.kind === "system") return isReasoning(row) && row.status === "completed";
  if (row.kind !== "work") return false;
  if (row.workKind === "command") return !isThreadTell(row);
  return row.workKind !== "approval" && row.workKind !== "question" && row.workKind !== "workflow";
}

function isBoundary(row: TimelineRow): boolean {
  return row.kind === "conversation" && !(row.role === "user" && row.turnRequest.status === "pending");
}

function intentKey(intent: ActivityIntent): string | null {
  switch (intent.type) {
    case "read": return `read:${intent.path ?? intent.name}`;
    case "list_files": return `list:${intent.path ?? ""}`;
    case "search": return `search:${intent.query ?? ""}|${intent.path ?? ""}`;
    case "unknown": return null;
    default: return unhandledIntent(intent);
  }
}

const isWork = (row: GroupRow): row is WorkRow => row.kind === "work";
const isUserMessage = (row: StepRow): boolean => row.kind === "conversation" && row.role === "user";
const asStep = (row: StepRow): Unit => ({ kind: "step", step: row });

function unhandledIntent(_intent: never): string | null {
  return null;
}
