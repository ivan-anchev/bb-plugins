import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { handoffIdSchema } from "../../model/agent/handoff.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { checkIdSchema, type StoredCheck } from "../../model/verdict/check.ts";
import { deltaOf, readInOrder } from "../../model/verdict/rounds/delta.ts";
import { reviewerBrief } from "./reviewer-brief.ts";

/** A git repository in a fresh folder on `main` (or `defaultBranch`), with origin's copy of it as a ref, and ways to run git and the shell in it. */
function repository(defaultBranch = "main") {
  const dir = mkdtempSync(join(tmpdir(), "reviewer-brief-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const git = (...args: string[]): string => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env, encoding: "utf8" }).trim();
  const sh = (command: string): string => execFileSync("sh", ["-c", command], { cwd: dir, env, encoding: "utf8" }).trim();
  const write = (lines: string[], file = "f.txt") => writeFileSync(join(dir, file), `${lines.join("\n")}\n`);
  const commit = (message: string): string => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  /** origin's copy of the default branch, at its tip now. */
  const pushed = () => git("update-ref", `refs/remotes/origin/${defaultBranch}`, git("rev-parse", defaultBranch));
  git("init", "-q", "-b", defaultBranch);
  return { dir, git, sh, write, commit, pushed };
}

const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);

/**
 * The commands a later round's reviewer is told to run (deltaText), as its brief gives them: the
 * two-tree diff, the file lists now and at the reviewed round, and the default branch's net change.
 */
function commandsOf(brief: string) {
  const diff = brief.split("\n\n## ").find((part) => part.startsWith("The diff")) ?? assert.fail("no diff section");
  const all = [...diff.matchAll(/`(git [^`]+)`/g)].map(([, command]) => command ?? "");
  const one = (test: (command: string) => boolean, what: string): string => all.find(test) ?? assert.fail(`no ${what} command`);
  return {
    twoTree: one((command) => /^git diff \S+ \S+$/.test(command), "two-tree"),
    lists: all.filter((command) => command.endsWith(" --stat")),
    upstream: one((command) => command.startsWith("git diff $(git merge-base"), "net upstream"),
  };
}

/** The brief of round 2 at `head`, after round 1 at `base`. */
function briefOf(base: string, head: string, defaultBranch = "main"): string {
  const delta = deltaOf(readInOrder([roundOne(base)]));
  if (delta.kind !== "after") return assert.fail("no base");
  const issue = { id: issueIdSchema.parse("WEB-1"), title: "Add retries", doneCriteria: ["npm test passes"], brief: "Retry failed deliveries.", decisions: [] };
  return reviewerBrief(issue, { headSha: head, prUrl: null, defaultBranch }, { ...delta, round: 1 }, null);
}

/** The files the brief's lists name, as git prints them in --stat. */
const filesIn = (sh: (command: string) => string, lists: readonly string[]): string[] =>
  [...new Set(lists.flatMap((list) => sh(`${list} --name-only`).split("\n").filter((line) => line !== "")))].sort();

/** Round 1 at `sha`: reviewed and judged, with nothing blocking, as the base of the next round. */
function roundOne(sha: string): StoredCheck {
  return {
    id: checkIdSchema.parse(randomUUID()),
    coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
    issueId: issueIdSchema.parse("WEB-1"),
    at: 3_000,
    criteria: ["npm test passes"],
    verifier: null,
    subject: { kind: "handoff", agentId: agentIdSchema.parse("a1"), handoffId: handoffIdSchema.parse(randomUUID()), headSha: sha, prUrl: null },
    review: { state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings: [], earlier: [], model: { providerId: "claude-code", model: "sonnet" } },
    verdict: {
      state: "returned",
      at: 5_000,
      verifierThreadId: "thr_v",
      headSha: sha,
      checkout: { headSha: sha, changedFiles: [], changedFileCount: 0 },
      criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }],
      findings: [],
      triage: [],
      mustFixFails: true,
      model: { providerId: "codex", model: "gpt-default" },
      sameModel: false,
      settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
    },
    followUpId: null,
  };
}


test("a file the branch put back as main has it since the reviewed round is still in the brief's file limit, and its change is reviewed", () => {
  const { dir, git, sh, write, commit, pushed } = repository();
  try {
    write(LINES);
    write(["g"], "g.txt");
    commit("start");
    pushed();
    git("checkout", "-qb", "feature");
    write([...LINES.slice(0, 2), "own addition", ...LINES.slice(2)]);
    write(["g", "more"], "g.txt");
    const base = commit("round 1: change f.txt and g.txt");
    write(LINES);
    const head = commit("round 2: put f.txt back as main has it");
    const { twoTree, lists, upstream } = commandsOf(briefOf(base, head));

    assert.equal(lists.length, 2, "the files now and at round 1");
    assert.deepEqual(filesIn(sh, lists.slice(0, 1)), ["g.txt"], "why not now alone: f.txt is main's again");
    assert.deepEqual(filesIn(sh, lists), ["f.txt", "g.txt"], "f.txt is in the limit through round 1's list");
    assert.match(sh(`${twoTree} -- f.txt`), /^-own addition$/m, "the change to review");
    assert.equal(sh(upstream.replace("<file>", "f.txt")), "", "and main changed nothing of it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main's net change since the reviewed round leaves out only what main changed: its kept change, not a line it added and took back, nor the branch's own removal", () => {
  const { dir, git, sh, write, commit, pushed } = repository();
  try {
    write(LINES);
    commit("start");
    pushed();
    git("checkout", "-qb", "feature");
    write([...LINES.slice(0, 2), "own addition", ...LINES.slice(2)]);
    const base = commit("round 1: add a line");
    git("checkout", "-q", "main");
    write([...LINES.slice(0, 10), "temp", ...LINES.slice(10)]);
    commit("main adds temp");
    write(LINES);
    commit("main takes temp back");
    write([...LINES.slice(0, 17), "main change", ...LINES.slice(18)]);
    commit("main changes line 18");
    pushed();
    git("checkout", "-q", "feature");
    git("merge", "-q", "--no-edit", "main");
    write([...LINES.slice(0, 10), "temp", ...LINES.slice(10, 17), "main change", ...LINES.slice(18)]);
    const head = commit("round 2: take back the addition, and add temp of its own");
    const { twoTree, upstream } = commandsOf(briefOf(base, head));

    const delta = sh(`${twoTree} -- f.txt`);
    const net = sh(upstream.replace("<file>", "f.txt"));
    assert.match(delta, /^-own addition$/m);
    assert.match(delta, /^\+temp$/m);
    assert.match(delta, /^\+main change$/m);
    assert.match(net, /^\+main change$/m, "main's kept change is left out");
    assert.doesNotMatch(net, /temp/, "main's added-then-taken-back line is no net change, so the branch's temp is reviewed");
    assert.doesNotMatch(net, /own addition/, "the branch's own removal is reviewed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a default branch whose name the shell would split, as release&stable, is quoted in every command, and each runs", () => {
  const { dir, git, sh, write, commit, pushed } = repository("release&stable");
  try {
    write(LINES);
    commit("start");
    pushed();
    git("checkout", "-qb", "feature");
    write(["changed", ...LINES.slice(1)]);
    const base = commit("round 1");
    write(["changed again", ...LINES.slice(1)]);
    const head = commit("round 2");
    const brief = briefOf(base, head, "release&stable");
    const { twoTree, lists, upstream } = commandsOf(brief);

    assert.ok(brief.includes("'origin/release&stable'"), "the ref as one quoted word");
    assert.doesNotMatch(brief, /[^']origin\/release&stable/, "never unquoted");
    assert.deepEqual(filesIn(sh, lists), ["f.txt"]);
    assert.match(sh(`${twoTree} -- f.txt`), /^\+changed again$/m);
    assert.equal(sh(upstream.replace("<file>", "f.txt")), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
