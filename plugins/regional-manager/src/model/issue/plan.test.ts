import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema, type Issue, type IssueId } from "./issue.ts";
import type { Kind } from "./kind.ts";
import { planProblem } from "./plan.ts";
import type { Closes } from "./relations.ts";

const id = (n: number): IssueId => issueIdSchema.parse(`i${n}`);
type Planned = Pick<Issue, "id" | "kind" | "parentId" | "dependsOn" | "closed">;
/** `i<n>`, open, of `kind`, under parent `parent` (null: none), depending on the issues numbered. */
const planned = (n: number, kind: Kind, parent: number | null, ...dependsOn: number[]): Planned => ({ id: id(n), kind, parentId: parent === null ? null : id(parent), dependsOn: dependsOn.map(id), closed: null });
const OPEN: Closes = new Map();
/** The issues numbered as a read finds them closed by work: a report each. */
const reported = (...ns: number[]): Closes => new Map(ns.map((n) => [id(n), { by: "merge", number: n }]));
const canceledAs = (issue: Planned): Planned => ({ ...issue, closed: { as: "canceled", at: 9_000 } });

test("a sub-issue goes one level deep, under an issue that is no sub-issue and has none of its own changed", () => {
  const plan = [planned(1, "build", null), planned(2, "build", 1), planned(3, "build", null)];
  assert.equal(planProblem(plan, planned(4, "build", 1), OPEN), null);
  assert.equal(planProblem(plan, planned(4, "build", 2), OPEN), "i4 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Put i4 under i1 instead");
  assert.equal(planProblem(plan, planned(1, "build", 3), OPEN), "i1 can't be a sub-issue of i3: it has sub-issues of its own (i2), and sub-issues go one level deep. Move them under i3 first");
  assert.equal(planProblem(plan, planned(4, "build", 9), OPEN), "i4 can't be a sub-issue of i9: there is no issue i9. Give i4 no parent, or an open top-level build issue as its parent");
  assert.equal(planProblem(plan, planned(3, "build", 3), OPEN), "i3 can't be a sub-issue of itself. Give i3 no parent, or an open top-level build issue as its parent");
  assert.equal(planProblem(plan, planned(2, "build", null), OPEN), null, "made top-level again");
});

test("a closed issue takes no new sub-issue, and keeps the ones it has", () => {
  const plan = [planned(1, "build", null), planned(2, "build", 1)];
  assert.equal(planProblem(plan, planned(3, "build", 1), reported(1)), "i3 can't be a sub-issue of i1: i1 is closed. Give i3 no parent, or an open top-level build issue as its parent");
  assert.equal(planProblem(plan, { ...planned(2, "build", 1), dependsOn: [] }, reported(1)), null);
});

test("the manager's closing acts are read from the plan as stored, whatever the read said", () => {
  const read: Closes = new Map([[id(1), { by: "manager", as: "canceled" }]]);
  assert.equal(planProblem([planned(1, "build", null)], planned(2, "build", 1), read), null, "reopened since the read");
  assert.equal(planProblem([canceledAs(planned(1, "build", null))], planned(2, "build", 1), OPEN), "i2 can't be a sub-issue of i1: i1 is closed. Give i2 no parent, or an open top-level build issue as its parent", "canceled since the read");
});

test("a parent holds only the kinds its kind holds, checked from the sub-issue and from the parent's new kind", () => {
  const plan = [planned(1, "research", null), planned(2, "build", null), planned(3, "build", 2)];
  assert.equal(planProblem(plan, planned(4, "research", 1), OPEN), null);
  assert.equal(planProblem(plan, planned(4, "research", 2), OPEN), null, "a build parent holds research");
  assert.equal(planProblem(plan, planned(4, "build", 1), OPEN), "i4 can't be a build sub-issue of i1: a research issue holds only research sub-issues. Give i4 no parent, or an open top-level build issue as its parent");
  assert.equal(planProblem(plan, planned(2, "research", null), OPEN), "i2 can't be research: it holds i3 (build), and a research issue holds only research sub-issues. Keep its kind, or make i3 top-level first with parent: null");
});

test("a parent is canceled only once every sub-issue is closed", () => {
  const plan = [planned(1, "build", null), planned(2, "build", 1), planned(3, "build", 1)];
  const canceled = canceledAs(planned(1, "build", null));
  assert.equal(planProblem(plan, canceled, reported(2)), "i1 can't be canceled while sub-issues of it are open: i3. Cancel them, or let them finish, first");
  assert.equal(planProblem(plan, canceled, reported(2, 3)), null);
  assert.equal(planProblem([plan[0], canceledAs(planned(2, "build", 1)), plan[2]], canceled, reported(3)), null, "i2 canceled as stored");
  assert.equal(planProblem(plan, { ...planned(1, "build", null), closed: { as: "accepted", at: 9_000 } }, OPEN), null, "accepting is the status's to judge: only In review can be");
});

test("the relations hold too, a parent's dependencies counted as its sub-issues'", () => {
  const plan = [planned(1, "build", null, 5), planned(2, "build", 1), planned(5, "build", null)];
  assert.equal(planProblem(plan, planned(5, "build", null, 2), OPEN), "i5 can't depend on i2: that would close a cycle, i5 → i2 → i5 (i1's dependency)");
  assert.equal(planProblem(plan, planned(2, "build", 1, 1), OPEN), "i2 can't depend on its parent i1: a parent closes only with its sub-issues");
});

test("each refusal of a parent offers only a way the kinds and the plan take", () => {
  const plan = [planned(1, "research", null), planned(2, "research", 1), planned(3, "build", null), planned(4, "build", 3)];
  assert.equal(
    planProblem(plan, planned(5, "build", 2), OPEN),
    "i5 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Give i5 no parent, or an open top-level build issue as its parent",
    "a research i1 can't hold a build i5",
  );
  assert.equal(planProblem(plan, planned(5, "research", 2), OPEN), "i5 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Put i5 under i1 instead");
  assert.equal(
    planProblem(plan, planned(5, "research", 2), reported(1)),
    "i5 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Give i5 no parent, or an open top-level build or research issue as its parent",
    "a closed i1 takes no new sub-issue",
  );
  assert.equal(
    planProblem(plan, planned(3, "build", 1), OPEN),
    "i3 can't be a sub-issue of i1: it has sub-issues of its own (i4), and sub-issues go one level deep. Make them top-level first with parent: null, then put i3 under an open top-level build issue",
    "a research i1 can hold neither i3 nor i4",
  );
  assert.equal(planProblem(plan, planned(1, "research", 3), OPEN), "i1 can't be a sub-issue of i3: it has sub-issues of its own (i2), and sub-issues go one level deep. Move them under i3 first");
  assert.equal(
    planProblem(plan, planned(2, "build", 1), OPEN),
    "i2 can't be a build sub-issue of i1: a research issue holds only research sub-issues. Keep i2 research, or give it no parent, or an open top-level build issue as its parent",
  );
});
