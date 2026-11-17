// "Depends on", the one relation between issues (seen from the other side as "blocks"), and what
// follows from it: blocked, ready, unblocked, and a cycle refused when written. Blocked is never
// stored: it is derived from the statuses issueViews derives (status.ts) on every read, so a
// research issue whose report a message reopened blocks its dependents again with nothing to update.
// Dependencies inform and never refuse: nothing here stops an agent from starting.
import type { Issue, IssueId } from "./issue.ts";
import type { Closure, IssueStatus, IssueView } from "./status.ts";

/** An issue as the relations read it: its id, the issues it depends on, and its parent. */
type Shape = Pick<Issue, "id" | "dependsOn" | "parentId">;

/** An issue as viewed: what the relations read of it. */
type Viewed = Pick<IssueView, "status" | "blockedBy" | "subIssues"> & { issue: Shape };

/** The other issue of a relation, with its status now. */
export type Related = { id: IssueId; status: IssueStatus };

/** An issue's relations: its parent (null: none) and sub-issues, the issues it depends on, and the issues it blocks (those that depend on it). */
export type Relations = { parent: Related | null; subIssues: Related[]; dependsOn: Related[]; blocks: Related[] };

/** A status in which an issue no longer blocks the issues that depend on it. */
type ClosedStatus = Extract<IssueStatus, "done" | "canceled">;

/** Whether an issue in this status no longer blocks the issues that depend on it. why Canceled too: a canceled dependency counts as closed (brief, open question 1). */
export const isClosed = (status: IssueStatus): status is ClosedStatus => status === "done" || status === "canceled";

/**
 * What blocks the issue now: its own and its parent's dependencies that are not closed, each with
 * its status. why the parent: a parent's dependencies block its sub-issues.
 */
export function blockedBy(issue: Pick<Shape, "dependsOn">, parent: Pick<Shape, "dependsOn"> | null, statusOf: (id: IssueId) => IssueStatus): Related[] {
  const dependencies = new Set([...issue.dependsOn, ...(parent?.dependsOn ?? [])]);
  return [...dependencies].map((id) => ({ id, status: statusOf(id) })).filter(({ status }) => !isClosed(status));
}

/** Ready: in Todo, not blocked, and not a parent: a parent never has an agent, its sub-issues do. crew_catch_up lists the ready issues. */
export const isReady = ({ status, blockedBy, subIssues }: Pick<IssueView, "status" | "blockedBy" | "subIssues">): boolean => status === "todo" && blockedBy.length === 0 && subIssues === null;

/** The issues ready in `after` that were not in `before`: what a write between the two readings made ready. */
export function newlyReady(before: readonly Viewed[], after: readonly Viewed[]): IssueId[] {
  const readyBefore = new Set(before.filter(isReady).map(({ issue }) => issue.id));
  return after.filter((view) => isReady(view) && !readyBefore.has(view.issue.id)).map(({ issue }) => issue.id);
}

/** An issue unblocked: `by`, the last of its dependencies still open, closed by its work (a merge, a report), and stands `closedAs`. */
export type Unblocking = { issueId: IssueId; by: IssueId; closedAs: ClosedStatus };

/** A close as the regional manager knows of it: one string per close, another for any other close. */
export type CloseKey = string;

/** Each issue's close as one read of every issue views it. An issue absent read open, as one filed since that read does: an issue is filed open. */
export type Closes = ReadonlyMap<IssueId, CloseKey>;

/** Each issue's close as these views, read whole, say. */
export const closesOf = (views: readonly (Pick<IssueView, "closedBy"> & { issue: Shape })[]): Closes =>
  new Map(views.flatMap(({ issue, closedBy }) => (closedBy === null ? [] : [[issue.id, closeKey(closedBy)] as const])));

/**
 * Of each issue's dependencies, the close the regional manager knows of: null while it has known it
 * open. Every relation has one from the moment it is written (issues-store.ts), and none outlives it.
 */
export type KnownCloses = ReadonlyMap<IssueId, ReadonlyMap<IssueId, CloseKey | null>>;

/** An issue as the unblocked announcement reads it. */
type Announced = Pick<IssueView, "status" | "blockedBy" | "closedBy"> & { issue: Shape };

/**
 * What every issue as viewed now says that `known` doesn't: the issues unblocked since, and the
 * relations whose dependency closed otherwise than known, with that close to know next. An open
 * issue nothing blocks is unblocked when one of its dependencies, or of its parent's, closed by its
 * work since (a merge, a report), with another close than the one known: none for a close the
 * manager made (its own result names what that made ready), nor for a dependency closed already
 * when the relation was written. A dependency that reads open keeps the close known: a research
 * issue a message reopened is news only once another handoff closes it, and one whose agent's
 * thread is gone until the agent ends is no news. A relation `known` doesn't hold was removed after
 * the views were read: it has nothing to tell, nor to remember. why a parent is never announced,
 * its sub-issues instead: a parent has no agent, so it is its sub-issues the manager can start.
 * An issue unblocked through its own relation and its parent's at once is announced once.
 */
export function unblockedSince(known: KnownCloses, views: readonly Announced[]): { unblocked: Unblocking[]; learned: Map<IssueId, Map<IssueId, CloseKey>> } {
  const byId = new Map(views.map((view) => [view.issue.id, view]));
  const reads = views.flatMap((view) => {
    const before = known.get(view.issue.id);
    return before === undefined ? [] : [{ view, ...dependenciesRead(view.issue, before, byId) }];
  });
  const announced = new Map<IssueId, Unblocking>();
  for (const { view, news: [by] } of reads) {
    if (by === undefined) continue;
    const subIssues = views.filter(({ issue }) => issue.parentId === view.issue.id);
    for (const { issue, status, blockedBy } of subIssues.length === 0 ? [view] : subIssues) {
      if (!isClosed(status) && blockedBy.length === 0 && !announced.has(issue.id)) announced.set(issue.id, { issueId: issue.id, ...by });
    }
  }
  return {
    unblocked: [...announced.values()],
    learned: new Map(reads.filter(({ closes }) => closes.size > 0).map(({ view, closes }) => [view.issue.id, closes])),
  };
}

/** The issue's dependencies read against the closes known of them: the dependencies closed otherwise than known, with that close, and those of them closed by work, in order. */
function dependenciesRead(issue: Shape, before: ReadonlyMap<IssueId, CloseKey | null>, byId: ReadonlyMap<IssueId, Announced>) {
  const closes = new Map<IssueId, CloseKey>();
  const news: Omit<Unblocking, "issueId">[] = [];
  for (const dependency of issue.dependsOn) {
    const was = before.get(dependency);
    const { status, closedBy } = named(byId, dependency);
    if (was === undefined || closedBy === null || closeKey(closedBy) === was) continue;
    closes.set(dependency, closeKey(closedBy));
    if (closedBy.by !== "manager" && isClosed(status)) news.push({ by: dependency, closedAs: status });
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
export function relationsOf(views: readonly Viewed[], { id, dependsOn, parentId }: Shape): Relations {
  const statuses = new Map(views.map(({ issue, status }) => [issue.id, status]));
  const related = (other: IssueId): Related => ({ id: other, status: statusIn(statuses, other) });
  return {
    parent: parentId === null ? null : related(parentId),
    subIssues: views.filter(({ issue }) => issue.parentId === id).map(({ issue }) => related(issue.id)),
    dependsOn: dependsOn.map(related),
    blocks: views.filter(({ issue }) => issue.dependsOn.includes(id)).map(({ issue }) => related(issue.id)),
  };
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
 * Why `changed`'s dependencies and parent, as a write would leave them, can't stand among the
 * regional manager's `issues` as stored, or null when they can: a dependency on no issue, on
 * itself, between a parent and its sub-issue, or one that closes a cycle, named as its path
 * ("i3 → i5 → i3"). `changed` is one of `issues` or a new one. why a parent and its sub-issues in
 * the cycle: a sub-issue waits for its parent's dependencies, and a parent closes only with its
 * sub-issues, so either can close one as surely as a dependency.
 */
export function relationProblem(issues: readonly Shape[], changed: Shape): string | null {
  const byId = new Map([...issues.map((issue) => [issue.id, issue] as const), [changed.id, changed]]);
  const subIssuesOf = (id: IssueId): IssueId[] => [...byId.values()].filter(({ parentId }) => parentId === id).map((sub) => sub.id);
  for (const dependency of changed.dependsOn) {
    if (!byId.has(dependency)) return `${changed.id} can't depend on ${dependency}: there is no issue ${dependency}`;
    if (dependency === changed.id) return `${changed.id} can't depend on itself`;
    if (dependency === changed.parentId) return `${changed.id} can't depend on its parent ${dependency}: a parent closes only with its sub-issues`;
    if (byId.get(dependency)?.parentId === changed.id) return `${changed.id} can't depend on its sub-issue ${dependency}: a parent closes only with its sub-issues`;
  }
  if (changed.parentId !== null && byId.get(changed.parentId)?.dependsOn.includes(changed.id)) {
    return `${changed.id} can't be a sub-issue of ${changed.parentId}: ${changed.parentId} depends on it, and a parent closes only with its sub-issues`;
  }
  const waits = (id: IssueId): Wait[] => {
    const issue = byId.get(id);
    const parentId = issue?.parentId ?? null;
    return [
      ...(issue?.dependsOn ?? []).map((to): Wait => ({ to, as: "dependency" })),
      ...(parentId === null ? [] : (byId.get(parentId)?.dependsOn ?? []).map((to): Wait => ({ to, as: "parent's dependency", parentId }))),
      ...subIssuesOf(id).map((to): Wait => ({ to, as: "sub-issue" })),
    ];
  };
  // why its sub-issues too: a parent's new dependency is waited for by them, not by the parent, so a cycle it closes runs through one of them.
  for (const start of [changed.id, ...subIssuesOf(changed.id)]) {
    const cycle = pathBack(waits, start, start, new Set());
    if (cycle !== null) return `${changed.id} can't ${cycleCause(changed.id, start, cycle[0])}: that would close a cycle, ${[start, ...cycle.map(waitText)].join(" → ")}`;
  }
  return null;
}

/** One issue waiting for another to close: as its own dependency, as its parent's, or as a parent waits for its sub-issue. */
type Wait = { to: IssueId; as: "dependency" | "sub-issue" } | { to: IssueId; as: "parent's dependency"; parentId: IssueId };

/** What of `changed` closes the cycle that starts at `start` with `first`: one of its dependencies, or its parent. */
function cycleCause(changed: IssueId, start: IssueId, first: Wait): string {
  if (first.as === "dependency" && start === changed) return `depend on ${first.to}`;
  if (first.as === "parent's dependency") return start === changed ? `be a sub-issue of ${first.parentId}` : `depend on ${first.to}`;
  return "be changed so";
}

/** The issue waited for, with how, when it is not by a dependency of its own. */
function waitText(wait: Wait): string {
  switch (wait.as) {
    case "dependency":
      return wait.to;
    case "parent's dependency":
      return `${wait.to} (${wait.parentId}'s dependency)`;
    case "sub-issue":
      return `${wait.to} (its sub-issue)`;
    default:
      return wait satisfies never;
  }
}

/** A path of waits from `from` to `target`, `target` included, or null when there is none. Depth first; `seen` keeps it from walking an issue twice. */
function pathBack(waits: (id: IssueId) => Wait[], from: IssueId, target: IssueId, seen: Set<IssueId>): [Wait, ...Wait[]] | null {
  for (const wait of waits(from)) {
    if (wait.to === target) return [wait];
    if (seen.has(wait.to)) continue;
    seen.add(wait.to);
    const rest = pathBack(waits, wait.to, target, seen);
    if (rest !== null) return [wait, ...rest];
  }
  return null;
}
