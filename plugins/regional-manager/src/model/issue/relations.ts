// "Depends on", the one relation between issues (seen from the other side as "blocks"), and what
// follows from it: blocked, ready, unblocked, and a cycle refused when written. Blocked is never
// stored: it is derived from the statuses issueViews derives (status.ts) on every read, so a
// research issue whose report a message reopened blocks its dependents again with nothing to update.
// Dependencies inform and never refuse: nothing here stops an agent from starting.
import type { Issue, IssueId } from "./issue.ts";
import type { Closure, IssueStatus, IssueView } from "./status.ts";

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

/** An issue unblocked: `by`, the last of its dependencies still open, closed by its work (a merge, a report), and stands `closedAs`. */
export type Unblocking = { issueId: IssueId; by: IssueId; closedAs: ClosedStatus };

/** A close as the announcement remembers it: one string per close, another for any other close. */
export type CloseKey = string;

/** Of each issue's dependencies, the close the regional manager knows of: null while it has known it open. */
export type KnownCloses = ReadonlyMap<IssueId, ReadonlyMap<IssueId, CloseKey | null>>;

/** An issue as the unblocked announcement reads it. */
type Announced = Pick<IssueView, "status" | "blockedBy" | "closedBy"> & { issue: Shape };

/**
 * What every issue as viewed now says that `known` doesn't: the issues unblocked since, and what
 * the regional manager knows next. An open issue nothing blocks is unblocked when one of its
 * dependencies closed by its work since (a merge, a report), with another close than the one
 * known: none for a close the manager made (its own result names what that made ready), nor for a
 * dependency first seen, as when the issue is filed depending on one closed already. A dependency
 * that reads open keeps the close known: a research issue a message reopened is news only once
 * another handoff closes it, and one whose agent's thread is gone until the agent ends is no news.
 */
export function unblockedSince(known: KnownCloses, views: readonly Announced[]): { unblocked: Unblocking[]; known: Map<IssueId, Map<IssueId, CloseKey | null>> } {
  const byId = new Map(views.map((view) => [view.issue.id, view]));
  const reads = views.filter(({ issue }) => issue.dependsOn.length > 0).map((view) => ({ view, ...dependenciesRead(view.issue, known.get(view.issue.id), byId) }));
  return {
    unblocked: reads.flatMap(({ view: { issue, status, blockedBy }, news: [by] }) => (by !== undefined && !isClosed(status) && blockedBy.length === 0 ? [{ issueId: issue.id, ...by }] : [])),
    known: new Map(reads.map(({ view, closes }) => [view.issue.id, closes])),
  };
}

/**
 * The issue's dependencies read against the closes known of them (`before`; undefined: none, as for
 * an issue first seen): the close of each to know next, and those closed by work since, in order.
 */
function dependenciesRead(issue: Shape, before: ReadonlyMap<IssueId, CloseKey | null> | undefined, byId: ReadonlyMap<IssueId, Announced>) {
  const closes = new Map<IssueId, CloseKey | null>();
  const news: Omit<Unblocking, "issueId">[] = [];
  for (const dependency of issue.dependsOn) {
    const { status, closedBy } = named(byId, dependency);
    const was = before?.get(dependency);
    if (closedBy === null) {
      closes.set(dependency, was ?? null);
      continue;
    }
    const close = closeKey(closedBy);
    closes.set(dependency, close);
    if (was !== undefined && close !== was && closedBy.by !== "manager" && isClosed(status)) news.push({ by: dependency, closedAs: status });
  }
  return { closes, news };
}

function closeKey(closure: Closure): CloseKey {
  switch (closure.by) {
    case "manager":
      return `${closure.as} at ${closure.at}`;
    case "merge":
      return `merged #${closure.number}`;
    case "handoff":
      return `handed off ${closure.handoffId}`;
    default:
      return closure satisfies never;
  }
}

/** The relations of `issue` among every issue of its regional manager, as viewed. */
export function relationsOf(views: readonly Viewed[], { id, dependsOn }: Shape): Relations {
  const statuses = new Map(views.map(({ issue, status }) => [issue.id, status]));
  const related = (other: IssueId): Related => ({ id: other, status: statusIn(statuses, other) });
  return { dependsOn: dependsOn.map(related), blocks: views.filter(({ issue }) => issue.dependsOn.includes(id)).map(({ issue }) => related(issue.id)) };
}

/** The issue's status among `statuses`. */
export const statusIn = (statuses: ReadonlyMap<IssueId, IssueStatus>, id: IssueId): IssueStatus => named(statuses, id);

/** What `byId` holds for an issue a relation names. why throw: a relation is written only between issues of one regional manager, and issues are never deleted. */
function named<T>(byId: ReadonlyMap<IssueId, T>, id: IssueId): T {
  const value = byId.get(id);
  if (value === undefined) throw new Error(`The issue ${id} a relation names is missing.`);
  return value;
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
