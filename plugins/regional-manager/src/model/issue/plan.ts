import type { Issue } from "./issue.ts";
import { kindSchema, PIPELINES, type Kind } from "./kind.ts";
import { relationProblem, type Closes } from "./relations.ts";

/** An issue as the plan reads it. */
type Planned = Pick<Issue, "id" | "kind" | "parentId" | "dependsOn" | "closed">;

type IsClosed = (issue: Planned) => boolean;

/**
 * Why `changed`, as a write would leave it, can't stand among the regional manager's `issues` as
 * stored, or null when it can. `changed` is one of `issues` or a new one. `closes`: every issue's
 * close as a read no change has overtaken says (current-views.ts); an issue absent reads open, as
 * one filed since that read does. why the manager's acts from `issues` instead: they are stored,
 * so the rows the write holds say them as they are now, whatever the read said.
 */
export function planProblem(issues: readonly Planned[], changed: Planned, closes: Closes): string | null {
  const was = issues.find(({ id }) => id === changed.id) ?? null;
  const after = [...issues.filter(({ id }) => id !== changed.id), changed];
  const subIssues = after.filter(({ parentId }) => parentId === changed.id);
  const isClosed: IsClosed = ({ id, closed }) => {
    const read = closes.get(id);
    return closed !== null || (read !== undefined && read.by !== "manager");
  };
  return parentProblem(after, changed, was, subIssues, isClosed) ?? kindProblem(after, changed, was) ?? cancelProblem(changed, was, subIssues, isClosed) ?? relationProblem(issues, changed);
}

function parentProblem(after: readonly Planned[], changed: Planned, was: Planned | null, subIssues: readonly Planned[], isClosed: IsClosed): string | null {
  if (changed.parentId === null) return null;
  const parent = after.find(({ id }) => id === changed.parentId);
  if (parent === undefined) return `${changed.id} can't be a sub-issue of ${changed.parentId}: there is no issue ${changed.parentId}. ${placeInstead(changed)}`;
  if (parent.id === changed.id) return `${changed.id} can't be a sub-issue of itself. ${placeInstead(changed)}`;
  if (parent.parentId !== null) {
    const top = after.find(({ id }) => id === parent.parentId);
    const instead = subIssues.length > 0 ? detachFirst(changed, subIssues) : top !== undefined && holds(top, [changed]) && !isClosed(top) ? `Put ${changed.id} under ${top.id} instead` : placeInstead(changed);
    return `${changed.id} can't be a sub-issue of ${parent.id}: ${parent.id} is a sub-issue of ${parent.parentId}, and sub-issues go one level deep. ${instead}`;
  }
  if (subIssues.length > 0) return `${changed.id} can't be a sub-issue of ${parent.id}: it has sub-issues of its own (${ids(subIssues)}), and sub-issues go one level deep. ${detachFirst(changed, subIssues)}`;
  if (was?.parentId !== parent.id && isClosed(parent)) return `${changed.id} can't be a sub-issue of ${parent.id}: ${parent.id} is closed. ${placeInstead(changed)}`;
  return null;
}

function kindProblem(after: readonly Planned[], changed: Planned, was: Planned | null): string | null {
  const parent = after.find(({ id }) => id === changed.parentId);
  if (parent !== undefined && !holds(parent, [changed])) {
    const instead = was !== null && was.kind !== changed.kind ? `Keep ${changed.id} ${label(was.kind)}, or give it ${elsewhere(changed.kind)}` : placeInstead(changed);
    return `${changed.id} can't be a ${label(changed.kind)} sub-issue of ${parent.id}: ${holdsText(parent.kind)}. ${instead}`;
  }
  const misfits = after.filter((sub) => sub.parentId === changed.id && !holds(changed, [sub]));
  if (misfits.length === 0) return null;
  const held = misfits.map(({ id, kind }) => `${id} (${label(kind)})`).join(", ");
  return `${changed.id} can't be ${label(changed.kind)}: it holds ${held}, and ${holdsText(changed.kind)}. Keep its kind, or make ${ids(misfits)} top-level first with parent: null`;
}

const detachFirst = (issue: Planned, subIssues: readonly Planned[]): string =>
  `Make ${ids(subIssues)} top-level first with parent: null, then put ${issue.id} under an open top-level ${holdersOf(issue.kind)} issue, or leave ${issue.id} top-level`;

const placeInstead = (issue: Planned): string => `Give ${issue.id} ${elsewhere(issue.kind)}`;

const elsewhere = (kind: Kind): string => `no parent, or an open top-level ${holdersOf(kind)} issue as its parent`;

const holds = (parent: Planned, subIssues: readonly Planned[]): boolean => subIssues.every(({ kind }) => PIPELINES[parent.kind].holds.includes(kind));

const holdersOf = (kind: Kind): string =>
  kindSchema.options
    .filter((parent) => PIPELINES[parent].holds.includes(kind))
    .map(label)
    .join(" or ");

const holdsText = (kind: Kind): string => `a ${label(kind)} issue holds only ${PIPELINES[kind].holds.map(label).join(" or ")} sub-issues`;

function cancelProblem(changed: Planned, was: Planned | null, subIssues: readonly Planned[], isClosed: IsClosed): string | null {
  if (changed.closed?.as !== "canceled" || was?.closed?.as === "canceled") return null;
  const open = subIssues.filter((sub) => !isClosed(sub));
  return open.length === 0 ? null : `${changed.id} can't be canceled while sub-issues of it are open: ${ids(open)}. Cancel them, or let them finish, first`;
}

const ids = (issues: readonly Planned[]): string => issues.map(({ id }) => id).join(", ");

const label = (kind: Kind): string => PIPELINES[kind].label.toLowerCase();
