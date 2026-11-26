import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Cli } from "../host-command.ts";
import { parsePrHead, parsePrUrl, prHeadQueryArgs, readGitHub } from "./pr-query.ts";

// gh's answer to this exact query, run read-only against ivan-anchev/bb-plugins for three branches
// with merged pull requests and one with none (gh 2.97.0, 2026-11-16).
const RECORDED = readFileSync(new URL("./fixtures/bb-plugins-prs.json", import.meta.url), "utf8");
const RECORDED_BRANCHES = ["fix-pr-reviews-sticky-gap", "release-pr-reviews-0.2.6", "pr-reviews/tooltip-popover-roles", "no-such-branch-08"];

/** gh answering every run with `stdout`, and the arguments of each run it was given. */
function ghAnswering(stdout: string) {
  const runs: [Cli, string[]][] = [];
  const run = async (cli: Cli, args: string[]) => {
    runs.push([cli, args]);
    return stdout;
  };
  return { run, runs };
}

/** Each branch's pull request as readGitHub read them from gh's `stdout`; null when it couldn't. */
async function parsed(stdout: string, branches: readonly string[]) {
  const read = await readGitHub(ghAnswering(stdout).run, "ivan-anchev/bb-plugins", branches);
  return read.kind === "read" ? read.prs : null;
}

test("a real answer parses into each branch's pull request, and null for a branch with none", async () => {
  const prs = await parsed(RECORDED, RECORDED_BRANCHES);
  assert.deepEqual(prs?.get("fix-pr-reviews-sticky-gap"), {
    forge: "github",
    number: 142,
    url: "https://github.com/ivan-anchev/bb-plugins/pull/142",
    state: "merged",
    draft: false,
    review: "none",
    ci: "pass",
    headSha: "e5d6348a11486b29901faac2409e07a7a3491be4",
    failedChecks: [],
  });
  assert.equal(prs?.get("pr-reviews/tooltip-popover-roles")?.number, 138);
  assert.equal(prs?.get("no-such-branch-08"), null);
});

test("the read runs gh once with no --hostname, the repository and every branch as variables, never in its text", async () => {
  const branch = 'feat/a "quoted" } branch';
  const gh = ghAnswering(RECORDED);
  await readGitHub(gh.run, "octo-org/widgets", ["main", branch]);
  const [[cli, args] = assert.fail("gh never ran")] = gh.runs;
  assert.equal(cli, "gh");
  assert.equal(gh.runs.length, 1);
  const query = args.find((arg) => arg.startsWith("query=")) ?? assert.fail("no query");
  assert.ok(!query.includes(branch) && !query.includes("octo-org"));
  assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
  assert.ok(!args.includes("--hostname"), "github.com, gh's default host, as before GitLab was read");
  for (const field of ["owner=octo-org", "name=widgets", "b0=main", `b1=${branch}`]) assert.ok(args.includes(field), field);
});

type Rollup = { state: string; contexts: { nodes: object[] } } | null;
const answer = (node: { state?: string; isDraft?: boolean; reviewDecision?: string | null; rollup?: Rollup }) =>
  JSON.stringify({
    data: {
      repository: {
        b0: {
          nodes: [
            {
              number: 7,
              url: "https://github.com/octo-org/widgets/pull/7",
              state: node.state ?? "OPEN",
              isDraft: node.isDraft ?? false,
              reviewDecision: node.reviewDecision ?? null,
              commits: { nodes: [{ commit: { oid: "c".repeat(40), statusCheckRollup: node.rollup === undefined ? null : node.rollup } }] },
            },
          ],
        },
      },
    },
  });
const one = async (node: Parameters<typeof answer>[0]) => (await parsed(answer(node), ["feat"]))?.get("feat");

test("failing CI names each failed check run and status, and nothing that passed or is still running", async () => {
  const pr = await one({
    rollup: {
      state: "FAILURE",
      contexts: {
        nodes: [
          { __typename: "CheckRun", name: "test", conclusion: "FAILURE" },
          { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS" },
          { __typename: "CheckRun", name: "build", conclusion: null },
          { __typename: "CheckRun", name: "e2e", conclusion: "TIMED_OUT" },
          { __typename: "StatusContext", context: "ci/legacy", state: "ERROR" },
          { __typename: "StatusContext", context: "ci/ok", state: "SUCCESS" },
          { __typename: "SomethingNew" },
        ],
      },
    },
  });
  assert.equal(pr?.ci, "fail");
  assert.deepEqual(pr?.failedChecks, ["test", "e2e", "ci/legacy"]);
});

test("a rollup state GitHub adds later is pending, never a pass; no rollup means no checks", async () => {
  assert.equal((await one({ rollup: { state: "QUEUED_SOMEHOW", contexts: { nodes: [] } } }))?.ci, "pending");
  assert.equal((await one({ rollup: { state: "EXPECTED", contexts: { nodes: [] } } }))?.ci, "pending");
  assert.equal((await one({ rollup: { state: "SUCCESS", contexts: { nodes: [] } } }))?.ci, "pass");
  assert.equal((await one({}))?.ci, "none");
});

test("review decisions and draft state", async () => {
  assert.equal((await one({ reviewDecision: "APPROVED" }))?.review, "approved");
  assert.equal((await one({ reviewDecision: "CHANGES_REQUESTED" }))?.review, "changes-requested");
  assert.equal((await one({ reviewDecision: "REVIEW_REQUIRED" }))?.review, "none");
  assert.equal((await one({ isDraft: true }))?.draft, true);
  assert.equal((await one({ state: "CLOSED" }))?.state, "closed");
});

test("an answer that isn't the pull requests asked for is not read as data, and says so as GitHub's, for now", async () => {
  const unreadable = { kind: "unavailable", unavailable: { kind: "transient", reason: "GitHub's answer wasn't the pull requests the plugin asked for", forge: "github" } };
  assert.deepEqual(await readGitHub(ghAnswering("not json").run, "o/r", ["feat"]), unreadable);
  assert.deepEqual(await readGitHub(ghAnswering(JSON.stringify({ data: { repository: {} } })).run, "o/r", ["feat"]), unreadable, "a branch's field is missing");
  assert.deepEqual(await readGitHub(ghAnswering(JSON.stringify({ errors: [{ message: "Something went wrong" }] })).run, "o/r", ["feat"]), unreadable);
  assert.deepEqual(await readGitHub(ghAnswering(answer({ state: "SOMETHING_ELSE" })).run, "o/r", ["feat"]), unreadable);
});

// gh's answer to prHeadQueryArgs for ivan-anchev/bb-plugins#142, run read-only (gh 2.97.0, 2026-11-26).
const RECORDED_HEAD = readFileSync(new URL("./fixtures/bb-plugins-pr-head.json", import.meta.url), "utf8");

test("a real answer names the branch a pull request is from; one naming none, or not an answer, names nothing", () => {
  assert.equal(parsePrHead(RECORDED_HEAD), "fix-pr-reviews-sticky-gap");
  assert.equal(parsePrHead(JSON.stringify({ data: { repository: { pullRequest: null } } })), null);
  assert.equal(parsePrHead("not json"), null);
  assert.equal(parsePrHead(JSON.stringify({ data: { repository: { pullRequest: { headRefName: "" } } } })), null);
});

test("a github.com pull request's URL names its repository and number, and the head query takes both as variables", () => {
  const named = parsePrUrl("https://github.com/Octo-Org/widgets/pull/41/files#diff-1") ?? assert.fail("a pull request URL");
  assert.deepEqual(named, { repo: "Octo-Org/widgets", number: 41 });
  const args = prHeadQueryArgs(named.repo, named.number);
  assert.deepEqual(args.slice(4), ["-f", "owner=Octo-Org", "-f", "name=widgets", "-F", "number=41"]);
  assert.doesNotMatch(args[3] ?? "", /widgets|41/);
  for (const other of ["https://github.com/octo-org/widgets/issues/41", "https://gitlab.com/octo-org/widgets/pull/41", "https://github.com/octo-org/widgets/pull/", "https://github.com/octo-org/widgets/pull/41x"]) assert.equal(parsePrUrl(other), null, other);
});
