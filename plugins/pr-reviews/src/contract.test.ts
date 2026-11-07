import assert from "node:assert/strict";
import { test } from "node:test";
import { commitsSince, type PrDetail } from "./contract.ts";

const pr = (commits: string[]): PrDetail => ({
  number: 23,
  title: "Fixture",
  author: "ivan-anchev",
  updatedAt: "2026-11-07T00:00:00Z",
  headSha: commits.at(-1) ?? "",
  body: "",
  url: "https://github.com/ivan-anchev/bb-plugins/pull/23",
  headRefName: "fixture/pr-reviews-live",
  baseRefName: "main",
  state: "OPEN",
  commits,
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
