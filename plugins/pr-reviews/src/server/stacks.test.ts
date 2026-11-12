import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrState } from "../contract.ts";
import { repoSchema, type Repo } from "../github/repo.ts";
import { buildStacks } from "./stacks.ts";

const BB = repoSchema.parse("ivan-anchev/bb-plugins");
const ATLAS = repoSchema.parse("octo-org/atlas");

type Pr = { repo: Repo; number: number; state: PrState; baseRefName: string; headRefName: string };

// PR `number` on branch `pr-<number>`, based on `base`.
const pr = (number: number, base: string, state: PrState = "OPEN", repo: Repo = BB): Pr => ({ repo, number, state, baseRefName: base, headRefName: `pr-${number}` });

const numbers = (stacks: Pr[][]) => stacks.map((stack) => stack.map((member) => member.number));

test("a chain reads bottom first, whatever order its PRs come in", () => {
  assert.deepEqual(numbers(buildStacks([pr(89, "pr-88"), pr(87, "pr-86"), pr(86, "main"), pr(88, "pr-87")])), [[86, 87, 88, 89]]);
});

test("a PR on no other and under none is in no stack", () => {
  assert.deepEqual(numbers(buildStacks([pr(83, "main"), pr(84, "main"), pr(40, "feature-branch-without-a-pr")])), []);
});

test("a merged bottom stays the bottom", () => {
  assert.deepEqual(numbers(buildStacks([pr(87, "pr-86"), pr(86, "main", "MERGED"), pr(88, "pr-87", "DRAFT")])), [[86, 87, 88]]);
});

test("a stack whose bottom targets a branch with no PR starts at that bottom", () => {
  assert.deepEqual(numbers(buildStacks([pr(43, "pr-42"), pr(42, "feature/base")])), [[42, 43]]);
});

test("two PRs on the same one both follow it, each with the PRs above it", () => {
  const stacks = buildStacks([pr(58, "pr-56"), pr(57, "pr-56"), pr(56, "pr-55"), pr(55, "cursor/base"), pr(59, "pr-57")]);
  assert.deepEqual(numbers(stacks), [[55, 56, 57, 59, 58]]);
});

test("a head branch reused by a closed PR and an open one: the open one is the base", () => {
  const closed: Pr = { ...pr(10, "main", "CLOSED"), headRefName: "topic" };
  const open: Pr = { ...pr(12, "main"), headRefName: "topic" };
  assert.deepEqual(numbers(buildStacks([closed, open, pr(13, "topic")])), [[12, 13]]);
});

test("the same branch names in two repos make two stacks, not one", () => {
  const stacks = buildStacks([pr(2, "pr-1", "OPEN", ATLAS), pr(1, "main", "OPEN", ATLAS), pr(2, "pr-1"), pr(1, "main")]);
  assert.deepEqual(
    stacks.map((stack) => stack.map((member) => `${member.repo}#${member.number}`)),
    [
      ["octo-org/atlas#1", "octo-org/atlas#2"],
      ["ivan-anchev/bb-plugins#1", "ivan-anchev/bb-plugins#2"],
    ],
  );
});

test("PRs based on each other in a loop are in no stack, and the loop ends", () => {
  assert.deepEqual(numbers(buildStacks([pr(1, "pr-2"), pr(2, "pr-1")])), []);
});
