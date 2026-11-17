import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema, type IssueId } from "./issue.ts";
import { handoffIdSchema } from "../handoff.ts";
import { blockedBy, closesOf, knownClose, relationProblem, statusIn, unblockedSince, type CloseKey } from "./relations.ts";
import type { Closure, IssueStatus } from "./status.ts";

const id = (n: number): IssueId => issueIdSchema.parse(`i${n}`);
/** An issue as the relations read it: `i<n>` depending on the issues numbered. */
const shape = (n: number, ...dependsOn: number[]) => ({ id: id(n), dependsOn: dependsOn.map(id), parentId: null });

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

test("an issue is unblocked once by each close of a dependency its work made; never by the manager's close, a dependency closed when the relation was written, or one that only read open", () => {
  type Dependency = { status: IssueStatus; closedBy: Closure | null };
  const open: Dependency = { status: "in-progress", closedBy: null };
  const merged: Dependency = { status: "done", closedBy: { by: "merge", number: 41 } };
  /** Done by the agent's handoff number `n`. */
  const reported = (n: 1 | 2): Dependency => ({ status: "done", closedBy: { by: "handoff", handoffId: handoffIdSchema.parse(`00000000-0000-4000-8000-00000000000${n}`), at: 8_000 + n } });
  const canceled: Dependency = { status: "canceled", closedBy: { by: "manager", as: "canceled", at: 9_000 } };
  /** i1, i2 and i3 as `dependencies` says, and the issues depending on them: i4 on i1, i5 on i1 and i3, i6 on i2. */
  const views = (dependencies: [Dependency, Dependency, Dependency]) => {
    const statuses = new Map(dependencies.map(({ status }, i) => [id(i + 1), status]));
    const dependent = (n: number, ...on: number[]) => {
      const issue = shape(n, ...on);
      return { issue, status: "todo" as const, closedBy: null, blockedBy: blockedBy(issue, null, (other) => statusIn(statuses, other)) };
    };
    return [...dependencies.map((dependency, i) => ({ issue: shape(i + 1), blockedBy: [], ...dependency })), dependent(4, 1), dependent(5, 1, 3), dependent(6, 2)];
  };
  // The relations are written as i4, i5 and i6 are filed, knowing what the read their filing answered from said: i2 closed already.
  const filed = closesOf(views([open, reported(1), open]));
  const relations = (...on: number[]) => new Map(on.map((n): [IssueId, CloseKey | null] => [id(n), knownClose(filed, id(n))]));
  const known = new Map([
    [id(4), relations(1)],
    [id(5), relations(1, 3)],
    [id(6), relations(2)],
  ]);
  /** One read of every issue: what it announces, as "i4 by i1". */
  const read = (dependencies: [Dependency, Dependency, Dependency]): string[] => {
    const { unblocked, learned } = unblockedSince(known, views(dependencies));
    for (const [issueId, closes] of learned) for (const [dependency, close] of closes) known.get(issueId)?.set(dependency, close);
    return unblocked.map(({ issueId, by, closedAs }) => `${issueId} by ${by} ${closedAs}`);
  };

  assert.deepEqual(read([open, reported(1), open]), [], "i6 was filed depending on i2 already closed");
  assert.deepEqual(read([merged, reported(1), open]), ["i4 by i1 done"], "i5 is still blocked by i3");
  assert.deepEqual(read([merged, reported(1), open]), [], "nothing twice");
  assert.deepEqual(read([merged, reported(1), canceled]), [], "the manager canceled i5's last open dependency");
  assert.deepEqual(read([merged, open, canceled]), [], "i2 reopened, or its agent's thread gone until the agent ends");
  assert.deepEqual(read([merged, reported(1), canceled]), [], "i2 closed by the same handoff again");
  assert.deepEqual(read([merged, open, canceled]), [], "i2 reopened by a message");
  assert.deepEqual(read([merged, reported(2), canceled]), ["i6 by i2 done"], "i2 reported again");
  assert.deepEqual(unblockedSince(new Map(), views([merged, reported(1), canceled])), { unblocked: [], learned: new Map() }, "relations removed after the views were read tell and remember nothing");
});

test("a parent's dependency closing announces its open sub-issues nothing else blocks, once each, never the parent; the close is remembered on the parent's relation", () => {
  const sub = (n: number, ...on: number[]) => ({ ...shape(n, ...on), parentId: id(1) });
  const merged = { by: "merge", number: 41 } as const;
  /** i1 depends on i9 and holds i2, i3 (depends on i8) and i4 (closed); i9 and i8 as given. */
  const views = (i9: Closure | null, i8: Closure | null) => {
    const statuses = new Map<IssueId, IssueStatus>([
      [id(9), i9 === null ? "in-progress" : "done"],
      [id(8), i8 === null ? "in-progress" : "done"],
    ]);
    const parent = shape(1, 9);
    const viewed = (issue: ReturnType<typeof sub>, status: IssueStatus) => ({ issue, status, closedBy: null, blockedBy: status === "done" ? [] : blockedBy(issue, parent, (other) => statusIn(statuses, other)) });
    return [
      { issue: parent, status: "todo" as const, closedBy: null, blockedBy: blockedBy(parent, null, (other) => statusIn(statuses, other)) },
      viewed(sub(2), "todo"),
      viewed(sub(3, 8), "todo"),
      viewed(sub(4), "done"),
      { issue: shape(8), status: statuses.get(id(8)) ?? "todo", closedBy: i8, blockedBy: [] },
      { issue: shape(9), status: statuses.get(id(9)) ?? "todo", closedBy: i9, blockedBy: [] },
    ];
  };
  const known = new Map([
    [id(1), new Map<IssueId, CloseKey | null>([[id(9), null]])],
    [id(3), new Map<IssueId, CloseKey | null>([[id(8), null]])],
  ]);
  const read = (i9: Closure | null, i8: Closure | null): string[] => {
    const { unblocked, learned } = unblockedSince(known, views(i9, i8));
    for (const [issueId, closes] of learned) for (const [dependency, close] of closes) known.get(issueId)?.set(dependency, close);
    return unblocked.map(({ issueId, by }) => `${issueId} by ${by}`);
  };

  assert.deepEqual(read(merged, null), ["i2 by i9"], "i3 is still blocked by its own i8; i4 is closed; i1 is a parent");
  assert.deepEqual(known.get(id(1))?.get(id(9)), "merged #41");
  assert.deepEqual(read(merged, null), [], "nothing twice");
  assert.deepEqual(read(merged, { ...merged, number: 42 }), ["i3 by i8"]);
});

test("a cycle through a parent is refused: a sub-issue waits for its parent's dependencies, and a parent for its sub-issues", () => {
  const sub = (n: number, ...on: number[]) => ({ ...shape(n, ...on), parentId: id(1) });
  assert.equal(relationProblem([shape(1, 5), sub(2), shape(5)], shape(5, 2)), "i5 can't depend on i2: that would close a cycle, i5 → i2 → i5 (i1's dependency)");
  assert.equal(relationProblem([shape(1), sub(2), shape(5, 1)], sub(2, 5)), "i2 can't depend on i5: that would close a cycle, i2 → i5 → i1 → i2 (its sub-issue)");
  assert.equal(relationProblem([shape(1), sub(2), shape(5, 2)], shape(1, 5)), "i1 can't depend on i5: that would close a cycle, i2 → i5 (i1's dependency) → i2");
  assert.equal(relationProblem([shape(1, 5), shape(2), shape(5, 2)], sub(2)), "i2 can't be a sub-issue of i1: that would close a cycle, i2 → i5 (i1's dependency) → i2");
  assert.equal(relationProblem([shape(1), sub(2)], shape(1, 2)), "i1 can't depend on its sub-issue i2: a parent closes only with its sub-issues");
  assert.equal(relationProblem([shape(1, 2), shape(2)], sub(2)), "i2 can't be a sub-issue of i1: i1 depends on it, and a parent closes only with its sub-issues");
  assert.equal(relationProblem([shape(1, 5), sub(2), sub(3), shape(5)], sub(3, 2)), null, "a sub-issue may depend on its sibling");
});
