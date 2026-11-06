// bb's chat compaction, mirrored for the trail. bb computes it in its client from
// flat rows (ThreadScreen bundle: `as` walks a scope's rows, `es` and `ts` fold a
// run, `Zo` dedupes it, `Wo` words it), so a plugin can only recompute it.
// Consecutive work steps fold into one line that says what they did ("Explored
// 3 files, ran 2 commands"); messages, questions, and approvals stay their own
// lines and split the runs. A step's own label stays stepLabel's (steps.ts).
import type { ActivityIntent, ReasoningRow, StepRow, TimelineRow, WorkRow } from "./bb.ts";
import type { Delegate } from "./delegate.ts";
import { isRunning, plural } from "./roster.ts";
import { isReasoning, stepIntents, trailSteps } from "./steps.ts";
import { isThreadTell } from "./thread-tell.ts";
import { conceptOf, groupLabel, type Concept } from "./work-label.ts";

/** One trail line: a single step, or a run of steps folded into what they did. */
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

/**
 * A delegate's trail. Which steps share a line is bb's chat's call, made on the rows as their
 * source holds them, scope by scope (Delegate.scopes). Then what the trail does not show
 * (reasoning, the handback, the report, a child's own brief) leaves every line, and lines left
 * empty drop. While the delegate runs, bb's latest line is live, unless a message or its settled
 * turn closed it: a live group reads in the present tense. Liveness never moves a step between lines.
 */
export function trailItems(d: Delegate): WorkItem[] {
  const scopes = d.scopes.map(({ rows, closed }) => compact(rows, closed));
  // why: decided on bb's lines before anything is hidden, so a hidden latest line (reasoning) leaves none live.
  const live = isRunning(d) ? liveUnit(scopes.at(-1) ?? []) : null;
  const shown = new Set(trailSteps(d.steps ?? []).map((row) => row.id));
  return scopes.flat().flatMap((unit) => lines(unit, live, shown));
}

// ---------------------------------------------------------------- layer 2

/** What bb folds: completed reasoning, and work but approvals, questions, workflows, and thread tells. */
type GroupRow = WorkRow | ReasoningRow;

/** One of bb's lines before anything is hidden: a step, a folded run, or a settled turn's own lines. */
type Unit =
  | { kind: "step"; step: StepRow }
  | { kind: "group"; fold: Fold; rows: readonly GroupRow[] }
  | { kind: "turn"; units: readonly Unit[] };

/**
 * How bb folded a run: open (its bundle summary), or whole (its step summary) because a message
 * ended the run or because the run ends a scope bb's source holds settled.
 */
type Fold = "open" | "closed-at-message" | "closed-with-scope";

/**
 * bb's `as`. A message ends a run and folds it whole, even in an open scope; any other line that
 * cannot fold (a question, an approval, a turn) folds it as an open run, even in a closed one.
 * Only the last run follows the scope. A settled turn's rows fold closed (`is`).
 */
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

/**
 * bb's latest line (`cc`): the last that is not a user message. bb makes no closed group or turn
 * active (`lc`); here a run closed with its scope is, as the delegate runs on: a Claude Code
 * agent's row settles at launch. A run a message closed, or a settled turn, is done work.
 */
function liveUnit(units: readonly Unit[]): Unit | null {
  const latest = units.findLast((unit) => !(unit.kind === "step" && isUserMessage(unit.step)));
  if (!latest) return null;
  switch (latest.kind) {
    case "step": return latest;
    case "group": return latest.fold === "closed-at-message" ? null : latest;
    case "turn": return null;
  }
}

/** A unit's trail lines: what it shows of its steps, a settled turn's lines in its place. */
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

/** bb's `es`: two or more steps fold into one line; a single step, or reasoning alone, stays as it is. */
function foldClosed(run: readonly GroupRow[], fold: Exclude<Fold, "open">): Unit[] {
  if (run.length < 2 || !run.some(isWork)) return run.map(asStep);
  return [{ kind: "group", fold, rows: dedupe(run) }];
}

/** bb's `ts`: neighbours of one concept fold, two or more to a line; reasoning joins the run around it. */
function foldOpen(run: readonly GroupRow[]): Unit[] {
  const chunks: { concept: Concept; rows: GroupRow[] }[] = [];
  let leading: GroupRow[] = []; // reasoning before the first work step joins that step's chunk
  for (const row of run) {
    const last = chunks.at(-1);
    if (row.kind === "system") {
      if (last) last.rows.push(row);
      else leading.push(row);
      continue;
    }
    const concept = conceptOf(row) ?? "tools"; // why: bb folds forms with tools (`Xo`)
    if (last?.concept === concept) last.rows.push(row);
    else {
      chunks.push({ concept, rows: [...leading, row] });
      leading = [];
    }
  }
  return [...leading.map(asStep), ...chunks.map(({ rows }): Unit => (rows.length === 1 ? asStep(rows[0]) : { kind: "group", fold: "open", rows: dedupe(rows) }))];
}

/**
 * bb's `Zo`: a read, list, or search of the same target as the one just before it folds into it,
 * so it is neither counted nor shown again; a command keeps its other intents.
 */
function dedupe(rows: readonly GroupRow[]): GroupRow[] {
  let previous: string | null = null;
  const kept: GroupRow[] = [];
  for (const row of rows) {
    // why: bb starts over at reasoning and at work that reads nothing, but not at a command whose intents it cannot read.
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

/** bb's `ms`: how many of a group's steps failed or were stopped. */
function failureNote(rows: readonly GroupRow[]): string | null {
  const errors = rows.filter((row) => row.status === "error").length;
  const interrupted = rows.filter((row) => row.status === "interrupted").length;
  const parts = [errors > 0 ? plural(errors, "error") : null, interrupted > 0 ? `${interrupted} interrupted` : null];
  return parts.filter((part) => part !== null).join(", ") || null;
}

// ---------------------------------------------------------------- layer 3: rows

/** bb's `Jo`. A successful `bb thread tell` stays out too: bb shows it as a message (thread-tell.ts). */
function isGroupable(row: TimelineRow): row is GroupRow {
  if (row.kind === "system") return isReasoning(row) && row.status === "completed";
  if (row.kind !== "work") return false;
  if (row.workKind === "command") return !isThreadTell(row);
  return row.workKind !== "approval" && row.workKind !== "question" && row.workKind !== "workflow";
}

/** bb's `Yo`: a message ends a run, but not a user message still waiting for its turn. */
function isBoundary(row: TimelineRow): boolean {
  return row.kind === "conversation" && !(row.role === "user" && row.turnRequest.status === "pending");
}

/** bb's `To`: what an intent reads, lists, or searches; null for a command bb cannot read. */
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

/** `never` keeps the switch exhaustive; an intent a newer host adds reads as one bb cannot read. */
function unhandledIntent(_intent: never): string | null {
  return null;
}
