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

/** A git repository in a fresh folder, and a way to run git and the shell in it. */
function repository() {
  const dir = mkdtempSync(join(tmpdir(), "reviewer-brief-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const git = (...args: string[]): string => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env, encoding: "utf8" }).trim();
  const sh = (command: string): string => execFileSync("sh", ["-c", command], { cwd: dir, env, encoding: "utf8" }).trim();
  const write = (lines: string[]) => writeFileSync(join(dir, "f.txt"), `${lines.join("\n")}\n`);
  return { dir, git, sh, write };
}

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
  };
}

test("a later round's reviewer keeps the branch's own change that removes its earlier addition, and leaves out only the change of a commit merged in from the default branch", () => {
  const { dir, git, sh, write } = repository();
  try {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    git("init", "-q", "-b", "main");
    write(lines);
    git("add", "f.txt");
    git("commit", "-qm", "start");
    git("checkout", "-qb", "feature");
    write([...lines.slice(0, 2), "own addition", ...lines.slice(2)]);
    git("commit", "-qam", "round 1: add a line");
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    write([...lines.slice(0, 17), "main change", ...lines.slice(18)]);
    git("commit", "-qam", "the default branch changes line 18");
    const merged = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", merged);
    git("checkout", "-q", "feature");
    git("merge", "-q", "--no-edit", "main");
    write([...lines.slice(0, 17), "main change", ...lines.slice(18)]);
    git("commit", "-qam", "round 2: take back the round 1 addition");
    const head = git("rev-parse", "HEAD");

    const delta = deltaOf(readInOrder([roundOne(base)]));
    if (delta.kind !== "after") return assert.fail("no base");
    const issue = { id: issueIdSchema.parse("WEB-1"), title: "Add retries", doneCriteria: ["npm test passes"], brief: "Retry failed deliveries.", decisions: [] };
    const brief = reviewerBrief(issue, { headSha: head, prUrl: null, defaultBranch: "main" }, { ...delta, round: 1 }, null);

    const twoTree = git("diff", base, head, "--", "f.txt");
    assert.match(twoTree, /^-own addition$/m, "the round's own change: it takes back its earlier addition");
    assert.match(twoTree, /^\+main change$/m, "and the default branch's change, merged in");
    assert.doesNotMatch(git("diff", `origin/main...${head}`, "--", "f.txt"), /own addition/, "why the branch's three-dot diff can't be the test: it no longer shows the removal");

    const log = /`(git log --oneline [^`]+)`/.exec(brief)?.[1] ?? assert.fail("no log command in the brief");
    const listed = sh(log).split("\n").map((line) => line.split(" ")[0] ?? "");
    assert.deepEqual(listed, [git("rev-parse", "--short", merged)], "the brief's command lists only the commit merged in from the default branch");
    const left = git("show", merged, "--", "f.txt");
    assert.match(left, /^\+main change$/m, "the change the reviewer leaves out");
    assert.doesNotMatch(left, /own addition/, "the removal is no merged commit's change, so the reviewer reviews it");
    assert.match(brief, /Review every other change in it: it is the branch's own, a removal of something the branch added before included/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
