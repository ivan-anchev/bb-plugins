import assert from "node:assert/strict";
import { test } from "node:test";
import type { IssueStatus, ManagerIssues } from "../../../model/manager-issues.ts";
import { issueList, type IssueList } from "./issue-list.ts";

const NONE: ManagerIssues = { needsYou: [], underWay: [], parents: [], decisions: [] };

const issue = (id: string, status: IssueStatus = "in-progress", parentId: string | null = null) => ({ id, title: `Title of ${id}`, status, parentId });
const flagged = (id: string, parentId: string | null = null) => ({ ...issue(id, "in-progress", parentId), reason: `Why ${id} waits` });

/** Each group as its heading, then its lines: an issue's id, "  " before a nested one, "~" after a context one. */
function shape(list: IssueList | null): string[] {
  if (list === null) return [];
  const lines = list.groups.flatMap((group) => [
    `${group.name} ${group.count}`,
    ...group.lines.map((line) => (line.kind === "decision" ? `? ${line.question}` : `${line.nested ? "  " : ""}${line.id}${line.context ? "~" : ""}`)),
  ]);
  return list.hidden > 0 ? [...lines, `+${list.hidden} more`] : lines;
}

test("Needs you comes first, then In progress, each heading counting its issues", () => {
  const list = issueList({ ...NONE, needsYou: [flagged("WEB-3")], underWay: [issue("WEB-2", "reviewing"), issue("WEB-1")] });
  assert.deepEqual(shape(list), ["Needs you 1", "WEB-3", "In progress 2", "WEB-2", "WEB-1"]);
});

test("a manager with only one kind shows that group alone", () => {
  assert.deepEqual(shape(issueList({ ...NONE, underWay: [issue("WEB-1", "verifying")] })), ["In progress 1", "WEB-1"]);
  assert.deepEqual(shape(issueList({ ...NONE, needsYou: [flagged("WEB-1")] })), ["Needs you 1", "WEB-1"]);
});

test("nothing waiting on the user and nothing under way: no list at all", () => {
  assert.equal(issueList(NONE), null);
});

test("an open decision naming no listed issue is a Needs you line carrying its question, ahead of the issues", () => {
  const list = issueList({ ...NONE, needsYou: [flagged("WEB-2")], decisions: [{ id: "d1", question: "Ship on Friday?" }] });
  assert.deepEqual(shape(list), ["Needs you 2", "? Ship on Friday?", "WEB-2"]);
});

test("sub-issues hang under their parent in its group; the last ends the trunk", () => {
  const list = issueList({ ...NONE, underWay: [issue("WEB-1"), issue("WEB-2", "verifying", "WEB-1"), issue("WEB-3", "in-progress", "WEB-1")] });
  assert.deepEqual(shape(list), ["In progress 3", "WEB-1", "  WEB-2", "  WEB-3"]);
  const nested = list?.groups[0]?.lines.filter((line) => line.kind === "issue" && line.nested);
  assert.deepEqual(
    nested?.map((line) => line.kind === "issue" && line.last),
    [false, true],
  );
});

test("a flagged sub-issue flags itself: its parent heads it under Needs you as quiet context, with the parent's own status, and keeps its own place", () => {
  const list = issueList({ ...NONE, needsYou: [flagged("WEB-5", "WEB-4")], underWay: [issue("WEB-4")], parents: [] });
  assert.deepEqual(shape(list), ["Needs you 1", "WEB-4~", "  WEB-5", "In progress 1", "WEB-4"]);
  const head = list?.groups[0]?.lines[0];
  assert.deepEqual(head?.kind === "issue" && [head.status, head.reason], ["in-progress", null]);
});

test("a parent in neither group shows as context over its listed sub-issue, in the parent's own status", () => {
  const list = issueList({ ...NONE, underWay: [issue("WEB-5", "in-progress", "WEB-4")], parents: [{ id: "WEB-4", title: "Webhook schema", status: "todo" }] });
  assert.deepEqual(shape(list), ["In progress 1", "WEB-4~", "  WEB-5"]);
  const head = list?.groups[0]?.lines[0];
  assert.deepEqual(head?.kind === "issue" && [head.title, head.status, head.context], ["Webhook schema", "todo", true]);
});

test("a sub-issue whose parent the read doesn't name stands alone", () => {
  assert.deepEqual(shape(issueList({ ...NONE, underWay: [issue("WEB-5", "in-progress", "WEB-4")] })), ["In progress 1", "WEB-5"]);
});

test(`at most 8 lines, Needs you first, sub-issues counted, then how many more`, () => {
  const list = issueList({
    ...NONE,
    needsYou: [flagged("WEB-1"), flagged("WEB-2"), flagged("WEB-3")],
    underWay: [issue("WEB-4"), issue("WEB-5", "in-progress", "WEB-4"), issue("WEB-6"), issue("WEB-7"), issue("WEB-8"), issue("WEB-9"), issue("WEB-10"), issue("WEB-11"), issue("WEB-12")],
  });
  assert.deepEqual(shape(list), ["Needs you 3", "WEB-1", "WEB-2", "WEB-3", "In progress 9", "WEB-4", "  WEB-5", "WEB-6", "WEB-7", "WEB-8", "+4 more"]);
});

test(`exactly 9 lines all show, never "+1 more"`, () => {
  const nine = Array.from({ length: 9 }, (_, i) => issue(`WEB-${i + 1}`));
  assert.deepEqual(shape(issueList({ ...NONE, underWay: nine })), ["In progress 9", ...nine.map(({ id }) => id)]);
  const ten = [...nine, issue("WEB-10")];
  assert.deepEqual(shape(issueList({ ...NONE, underWay: ten })).at(-1), "+2 more");
});

test("the cap never ends on a context line without its sub-issues, nor keeps a heading with no lines", () => {
  const needsYou = Array.from({ length: 7 }, (_, i) => flagged(`WEB-${i + 1}`));
  const list = issueList({ ...NONE, needsYou, underWay: [issue("WEB-9", "in-progress", "WEB-8"), issue("WEB-10")], parents: [{ id: "WEB-8", title: "Parent", status: "todo" }] });
  assert.deepEqual(shape(list), ["Needs you 7", ...needsYou.map(({ id }) => id), "+3 more"]);
});
