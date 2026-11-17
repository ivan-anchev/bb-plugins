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
const closed = (...ns: number[]): Closes => new Map(ns.map((n) => [id(n), `canceled at ${n}`]));

test("a sub-issue goes one level deep, under an issue that is no sub-issue and has none of its own changed", () => {
  const plan = [planned(1, "build", null), planned(2, "build", 1), planned(3, "build", null)];
  assert.equal(planProblem(plan, planned(4, "build", 1), OPEN), null);
  assert.equal(planProblem(plan, planned(4, "build", 2), OPEN), "i4 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Put i4 under i1 instead");
  assert.equal(planProblem(plan, planned(1, "build", 3), OPEN), "i1 can't be a sub-issue of i3: it has sub-issues of its own (i2), and sub-issues go one level deep. Move them under i3 first");
  assert.equal(planProblem(plan, planned(4, "build", 9), OPEN), "i4 can't be a sub-issue of i9: there is no issue i9");
  assert.equal(planProblem(plan, planned(3, "build", 3), OPEN), "i3 can't be a sub-issue of itself");
  assert.equal(planProblem(plan, planned(2, "build", null), OPEN), null, "made top-level again");
});

test("a closed issue takes no new sub-issue, and keeps the ones it has", () => {
  const plan = [planned(1, "build", null), planned(2, "build", 1)];
  assert.equal(planProblem(plan, planned(3, "build", 1), closed(1)), "i3 can't be a sub-issue of i1: i1 is closed. File i3 on its own");
  assert.equal(planProblem(plan, { ...planned(2, "build", 1), dependsOn: [] }, closed(1)), null);
});

test("a parent holds only the kinds its kind holds, checked from the sub-issue and from the parent's new kind", () => {
  const plan = [planned(1, "research", null), planned(2, "build", null), planned(3, "build", 2)];
  assert.equal(planProblem(plan, planned(4, "research", 1), OPEN), null);
  assert.equal(planProblem(plan, planned(4, "research", 2), OPEN), null, "a build parent holds research");
  assert.equal(planProblem(plan, planned(4, "build", 1), OPEN), "i4 can't be a build sub-issue of i1: a research issue holds only research sub-issues");
  assert.equal(planProblem(plan, planned(2, "research", null), OPEN), "i2 can't be research: it holds i3, a build issue, and a research issue holds only research sub-issues");
});

test("a parent is canceled only once every sub-issue is closed", () => {
  const plan = [planned(1, "build", null), planned(2, "build", 1), planned(3, "build", 1)];
  const canceled = { ...planned(1, "build", null), closed: { as: "canceled", at: 9_000 } } as const;
  assert.equal(planProblem(plan, canceled, closed(2)), "i1 can't be canceled while sub-issues of it are open: i3. Cancel them, or let them finish, first");
  assert.equal(planProblem(plan, canceled, closed(2, 3)), null);
  assert.equal(planProblem(plan, { ...planned(1, "build", null), closed: { as: "accepted", at: 9_000 } }, OPEN), null, "accepting is the status's to judge: only In review can be");
});

test("the relations hold too, a parent's dependencies counted as its sub-issues'", () => {
  const plan = [planned(1, "build", null, 5), planned(2, "build", 1), planned(5, "build", null)];
  assert.equal(planProblem(plan, planned(5, "build", null, 2), OPEN), "i5 can't depend on i2: that would close a cycle, i5 → i2 → i5 (i1's dependency)");
  assert.equal(planProblem(plan, planned(2, "build", 1, 1), OPEN), "i2 can't depend on its parent i1: a parent closes only with its sub-issues");
});
