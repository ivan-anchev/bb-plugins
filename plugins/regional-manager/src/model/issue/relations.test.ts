import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema, type IssueId } from "./issue.ts";
import { blockedBy, relationProblem, unblockedBy } from "./relations.ts";
import type { IssueStatus } from "./status.ts";

const id = (n: number): IssueId => issueIdSchema.parse(`i${n}`);
/** An issue as the relations read it: `i<n>` depending on the issues numbered. */
const shape = (n: number, ...dependsOn: number[]) => ({ id: id(n), dependsOn: dependsOn.map(id) });

test("a dependency that closes a cycle is refused naming the whole path, however long; a diamond is no cycle", () => {
  const chain = [shape(1, 4), shape(2, 1), shape(3, 2), shape(4)];
  assert.equal(relationProblem(chain, shape(4, 3)), "i4 can't depend on i3: that would close a cycle, i4 → i3 → i2 → i1 → i4");
  assert.equal(relationProblem([shape(1), shape(2, 1), shape(3, 1), shape(4, 2, 3)], shape(5, 4)), null);
  assert.equal(relationProblem([shape(1), shape(2, 1), shape(3, 1), shape(4, 2, 3)], shape(1)), null, "removing every dependency");
});

test("blocked by is every open dependency, its own and its parent's, once each with its status; Done and Canceled block nothing", () => {
  const statuses: Record<string, IssueStatus> = { i1: "in-progress", i2: "done", i3: "canceled", i4: "todo" };
  const statusOf = (issueId: IssueId): IssueStatus => statuses[issueId] ?? assert.fail(`no status for ${issueId}`);
  assert.deepEqual(blockedBy(shape(5, 1, 2, 3), null, statusOf), [{ id: id(1), status: "in-progress" }]);
  assert.deepEqual(blockedBy(shape(5, 1, 2), shape(6, 4, 1), statusOf), [
    { id: id(1), status: "in-progress" },
    { id: id(4), status: "todo" },
  ]);
});

test("a close unblocks the open issues it was the last open dependency of, and no other", () => {
  const view = (n: number, status: IssueStatus, dependsOn: number[], blocked: number[]) => ({
    issue: shape(n, ...dependsOn),
    status,
    blockedBy: blocked.map((b) => ({ id: id(b), status: "todo" as const })),
  });
  const views = [view(1, "done", [], []), view(2, "todo", [1], []), view(3, "todo", [1, 4], [4]), view(4, "todo", [], []), view(5, "canceled", [1], []), view(6, "todo", [], [])];
  assert.deepEqual(unblockedBy(id(1), views), [id(2)]);
});
