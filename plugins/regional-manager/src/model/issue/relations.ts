// "Depends on", the one relation between issues (seen from the other side as "blocks"), and what
// follows from it: blocked, ready, unblocked, and a cycle refused when written. Blocked is never
// stored: it is derived from the statuses issueViews derives (status.ts) on every read, so a
// research issue whose report a message reopened blocks its dependents again with nothing to update.
// Dependencies inform and never refuse: nothing here stops an agent from starting.
import type { Issue, IssueId } from "./issue.ts";
import type { IssueStatus, IssueView } from "./status.ts";

/** An issue as the relations read it: its id and the issues it depends on. */
type Shape = Pick<Issue, "id" | "dependsOn">;

/** An issue as viewed: what the relations read of it. */
type Viewed = Pick<IssueView, "status" | "blockedBy"> & { issue: Shape };

/** The other issue of a relation, with its status now. */
export type Related = { id: IssueId; status: IssueStatus };

/** An issue's relations: the issues it depends on, and the issues it blocks (those that depend on it). */
export type Relations = { dependsOn: Related[]; blocks: Related[] };

/** A status in which an issue no longer blocks the issues that depend on it. */
type ClosedStatus = Extract<IssueStatus, "done" | "canceled">;

/** Whether an issue in this status no longer blocks the issues that depend on it. why Canceled too: a canceled dependency counts as closed (brief, open question 1). */
export const isClosed = (status: IssueStatus): status is ClosedStatus => status === "done" || status === "canceled";

/**
 * What blocks the issue now: its own and its parent's dependencies that are not closed, each with
 * its status. why the parent: a parent's dependencies block its sub-issues; until sub-issues exist
 * (issue 08) every caller passes null.
 */
export function blockedBy(issue: Shape, parent: Shape | null, statusOf: (id: IssueId) => IssueStatus): Related[] {
  const dependencies = new Set([...issue.dependsOn, ...(parent?.dependsOn ?? [])]);
  return [...dependencies].map((id) => ({ id, status: statusOf(id) })).filter(({ status }) => !isClosed(status));
}

/** Ready: in Todo and not blocked. crew_catch_up lists the ready issues. */
export const isReady = ({ status, blockedBy }: Pick<IssueView, "status" | "blockedBy">): boolean => status === "todo" && blockedBy.length === 0;

/** The issues ready in `after` that were not in `before`: what a write between the two readings made ready. */
export function newlyReady(before: readonly Viewed[], after: readonly Viewed[]): IssueId[] {
  const readyBefore = new Set(before.filter(isReady).map(({ issue }) => issue.id));
  return after.filter((view) => isReady(view) && !readyBefore.has(view.issue.id)).map(({ issue }) => issue.id);
}

/**
 * The open issues that depend on `closed` and that nothing blocks now: those it was the last open
 * dependency of, given every issue as viewed after it closed.
 */
export const unblockedBy = (closed: IssueId, views: readonly Viewed[]): IssueId[] =>
  views.filter(({ issue, status, blockedBy }) => !isClosed(status) && issue.dependsOn.includes(closed) && blockedBy.length === 0).map(({ issue }) => issue.id);

/** The relations of `issue` among every issue of its regional manager, as viewed. */
export function relationsOf(views: readonly Viewed[], { id, dependsOn }: Shape): Relations {
  const statuses = new Map(views.map(({ issue, status }) => [issue.id, status]));
  const related = (other: IssueId): Related => ({ id: other, status: statusIn(statuses, other) });
  return { dependsOn: dependsOn.map(related), blocks: views.filter(({ issue }) => issue.dependsOn.includes(id)).map(({ issue }) => related(issue.id)) };
}

/** The issue's status among `statuses`. why throw: a relation is written only between issues of one regional manager, and issues are never deleted. */
export function statusIn(statuses: ReadonlyMap<IssueId, IssueStatus>, id: IssueId): IssueStatus {
  const status = statuses.get(id);
  if (status === undefined) throw new Error(`The issue ${id} a relation names is missing.`);
  return status;
}

/**
 * Why `changed`'s dependencies, as a write would leave them, can't stand among the regional
 * manager's `issues` as stored, or null when they can: a dependency on no issue, on itself, or one
 * that closes a cycle, named as its path ("i3 → i5 → i3"). `changed` is one of `issues` or a new one.
 */
export function relationProblem(issues: readonly Shape[], changed: Shape): string | null {
  const byId = new Map([...issues.map((issue) => [issue.id, issue] as const), [changed.id, changed]]);
  for (const dependency of changed.dependsOn) {
    if (!byId.has(dependency)) return `${changed.id} can't depend on ${dependency}: there is no issue ${dependency}`;
    if (dependency === changed.id) return `${changed.id} can't depend on itself`;
  }
  const cycle = pathBack(byId, changed.id, changed.id, new Set());
  return cycle === null ? null : `${changed.id} can't depend on ${cycle[0]}: that would close a cycle, ${[changed.id, ...cycle].join(" → ")}`;
}

/** A path of dependencies from `from` to `target`, `target` included, or null when there is none. Depth first; `seen` keeps it from walking an issue twice. An id with no issue depends on nothing. */
function pathBack(byId: ReadonlyMap<IssueId, Shape>, from: IssueId, target: IssueId, seen: Set<IssueId>): [IssueId, ...IssueId[]] | null {
  for (const next of byId.get(from)?.dependsOn ?? []) {
    if (next === target) return [next];
    if (seen.has(next)) continue;
    seen.add(next);
    const rest = pathBack(byId, next, target, seen);
    if (rest !== null) return [next, ...rest];
  }
  return null;
}
