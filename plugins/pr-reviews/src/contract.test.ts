import assert from "node:assert/strict";
import { test } from "node:test";
import { commitsSince, leadingOutcome, type PrDetail } from "./contract.ts";

const pr = (commits: string[]): PrDetail => ({
  number: 23,
  title: "Fixture",
  author: "ivan-anchev",
  updatedAt: "2026-11-07T00:00:00Z",
  createdAt: "2026-11-06T00:00:00Z",
  headSha: commits.at(-1) ?? "",
  body: "",
  url: "https://github.com/ivan-anchev/bb-plugins/pull/23",
  headRefName: "fixture/pr-reviews-live",
  baseRefName: "main",
  state: "OPEN",
  commits,
  additions: 1, deletions: 1, checks: [], reviewers: [], labels: [],
});

test("no commits since a guide for the PR's head", () => {
  assert.equal(commitsSince(pr(["a", "b"]), "b"), 0);
});

test("counts the commits after the guide's head", () => {
  assert.equal(commitsSince(pr(["a", "b", "c", "d"]), "b"), 2);
  assert.equal(commitsSince(pr(["a", "b", "c"]), "a"), 2);
});

test("null when a force push removed the guide's head from the PR", () => {
  assert.equal(commitsSince(pr(["x", "y"]), "b"), null);
});

test("checks are summed up as failing when any fails", () => {
  assert.deepEqual(leadingOutcome({ failing: 1, pending: 2, passing: 3 }), { outcome: "failing", count: 1 });
});

test("checks are summed up as pending when none fails and any is pending", () => {
  assert.deepEqual(leadingOutcome({ failing: 0, pending: 2, passing: 3 }), { outcome: "pending", count: 2 });
});

test("checks are summed up as passing when all pass", () => {
  assert.deepEqual(leadingOutcome({ failing: 0, pending: 0, passing: 3 }), { outcome: "passing", count: 3 });
});
