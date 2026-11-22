import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseGitHubRepo, parsePrs, prQueryArgs } from "./pr-query.ts";

const RECORDED = readFileSync(new URL("./fixtures/bb-plugins-prs.json", import.meta.url), "utf8");
const RECORDED_BRANCHES = ["fix-pr-reviews-sticky-gap", "release-pr-reviews-0.2.6", "pr-reviews/tooltip-popover-roles", "no-such-branch-08"];

test("a real answer parses into each branch's pull request, and null for a branch with none", () => {
  const prs = parsePrs(RECORDED, RECORDED_BRANCHES);
  assert.deepEqual(prs?.get("fix-pr-reviews-sticky-gap"), {
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

test("the query takes the repository and every branch as variables, never in its text", () => {
  const branch = 'feat/a "quoted" } branch';
  const args = prQueryArgs(parseGitHubRepo("git@github.com:octo-org/widgets.git") ?? assert.fail("a GitHub remote"), ["main", branch]);
  const query = args.find((arg) => arg.startsWith("query=")) ?? assert.fail("no query");
  assert.ok(!query.includes(branch) && !query.includes("octo-org"));
  assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
  for (const field of ["owner=octo-org", "name=widgets", "b0=main", `b1=${branch}`]) assert.ok(args.includes(field), field);
});

test("only a github.com remote names a repository", () => {
  assert.equal(parseGitHubRepo("https://github.com/Octo-Org/widgets.git"), "Octo-Org/widgets");
  assert.equal(parseGitHubRepo("ssh://git@github.com/octo-org/widgets"), "octo-org/widgets");
  assert.equal(parseGitHubRepo("https://gitlab.com/octo-org/widgets.git"), null);
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
const one = (node: Parameters<typeof answer>[0]) => parsePrs(answer(node), ["feat"])?.get("feat");

test("failing CI names each failed check run and status, and nothing that passed or is still running", () => {
  const pr = one({
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

test("a rollup state GitHub adds later is pending, never a pass; no rollup means no checks", () => {
  assert.equal(one({ rollup: { state: "QUEUED_SOMEHOW", contexts: { nodes: [] } } })?.ci, "pending");
  assert.equal(one({ rollup: { state: "EXPECTED", contexts: { nodes: [] } } })?.ci, "pending");
  assert.equal(one({ rollup: { state: "SUCCESS", contexts: { nodes: [] } } })?.ci, "pass");
  assert.equal(one({})?.ci, "none");
});

test("review decisions and draft state", () => {
  assert.equal(one({ reviewDecision: "APPROVED" })?.review, "approved");
  assert.equal(one({ reviewDecision: "CHANGES_REQUESTED" })?.review, "changes-requested");
  assert.equal(one({ reviewDecision: "REVIEW_REQUIRED" })?.review, "none");
  assert.equal(one({ isDraft: true })?.draft, true);
  assert.equal(one({ state: "CLOSED" })?.state, "closed");
});

test("an answer that isn't the pull requests asked for is not read as data", () => {
  assert.equal(parsePrs("not json", ["feat"]), null);
  assert.equal(parsePrs(JSON.stringify({ data: { repository: {} } }), ["feat"]), null, "a branch's field is missing");
  assert.equal(parsePrs(JSON.stringify({ errors: [{ message: "Something went wrong" }] }), ["feat"]), null);
  assert.equal(parsePrs(answer({ state: "SOMETHING_ELSE" }), ["feat"]), null);
});
