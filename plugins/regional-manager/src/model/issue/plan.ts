// The one rule for whether the regional manager's plan can stand, read on the plan as a write would
// leave it, inside the transaction that writes it: sub-issues go one level deep, under an open
// parent whose kind holds theirs; a parent is canceled only once its sub-issues are closed; and its
// relations hold (relations.ts relationProblem). Each refusal names the issues and what to do.
import type { Issue } from "./issue.ts";
import { PIPELINES, type Kind } from "./kind.ts";
import { relationProblem, type Closes } from "./relations.ts";

/** An issue as the plan reads it. */
type Planned = Pick<Issue, "id" | "kind" | "parentId" | "dependsOn" | "closed">;

/** Whether an issue is closed: by the manager's act, as stored now, or otherwise (a merge, a report, its sub-issues), as read. */
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
  return parentProblem(after, changed, was, subIssues, isClosed) ?? kindProblem(after, changed) ?? cancelProblem(changed, was, subIssues, isClosed) ?? relationProblem(issues, changed);
}

/** Why `changed` can't be a sub-issue of the parent it names: none, nested, or closed when newly named. */
function parentProblem(after: readonly Planned[], changed: Planned, was: Planned | null, subIssues: readonly Planned[], isClosed: IsClosed): string | null {
  if (changed.parentId === null) return null;
  const parent = after.find(({ id }) => id === changed.parentId);
  if (parent === undefined) return `${changed.id} can't be a sub-issue of ${changed.parentId}: there is no issue ${changed.parentId}`;
  if (parent.id === changed.id) return `${changed.id} can't be a sub-issue of itself`;
  if (parent.parentId !== null) return `${changed.id} can't be a sub-issue of ${parent.id}: ${parent.id} is a sub-issue of ${parent.parentId}, and sub-issues go one level deep. Put ${changed.id} under ${parent.parentId} instead`;
  if (subIssues.length > 0) return `${changed.id} can't be a sub-issue of ${parent.id}: it has sub-issues of its own (${ids(subIssues)}), and sub-issues go one level deep. Move them under ${parent.id} first`;
  // why only when newly named: a sub-issue of a parent closed since keeps it.
  if (was?.parentId !== parent.id && isClosed(parent)) return `${changed.id} can't be a sub-issue of ${parent.id}: ${parent.id} is closed. File ${changed.id} on its own`;
  return null;
}

/**
 * Why a parent of `changed`, or `changed` as a parent, can't hold the kind of a sub-issue (brief,
 * open question 7). why both ways: a sub-issue's kind is checked against its parent, and a parent's
 * new kind against every sub-issue it holds.
 */
function kindProblem(after: readonly Planned[], changed: Planned): string | null {
  for (const sub of after) {
    const parent = sub.parentId === null ? undefined : after.find(({ id }) => id === sub.parentId);
    if (parent === undefined || (sub.id !== changed.id && parent.id !== changed.id) || PIPELINES[parent.kind].holds.includes(sub.kind)) continue;
    const holds = `a ${label(parent.kind)} issue holds only ${PIPELINES[parent.kind].holds.map(label).join(" or ")} sub-issues`;
    return sub.id === changed.id ? `${sub.id} can't be a ${label(sub.kind)} sub-issue of ${parent.id}: ${holds}` : `${parent.id} can't be ${label(parent.kind)}: it holds ${sub.id}, a ${label(sub.kind)} issue, and ${holds}`;
  }
  return null;
}

/** Why `changed` can't be canceled now: it has sub-issues still open. */
function cancelProblem(changed: Planned, was: Planned | null, subIssues: readonly Planned[], isClosed: IsClosed): string | null {
  if (changed.closed?.as !== "canceled" || was?.closed?.as === "canceled") return null;
  const open = subIssues.filter((sub) => !isClosed(sub));
  return open.length === 0 ? null : `${changed.id} can't be canceled while sub-issues of it are open: ${ids(open)}. Cancel them, or let them finish, first`;
}

const ids = (issues: readonly Planned[]): string => issues.map(({ id }) => id).join(", ");

const label = (kind: Kind): string => PIPELINES[kind].label.toLowerCase();
