import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePrDetail } from "./gh.ts";

// `gh pr view 42 --json <DETAIL_FIELDS>` for this repo, trimmed; each test swaps in the fields it covers.
const PR_42 = {
  number: 42,
  title: "Add Summary and Guide tabs to the PR page",
  author: { id: "MDQ6VXNlcjQ2MDUwMjk3", is_bot: false, login: "ivan-anchev", name: "Ivan Anchev" },
  updatedAt: "2026-11-08T07:06:33Z",
  headRefOid: "ec618b08a91e3f5e179ba46d1e43c6f6aeddfb53",
  createdAt: "2026-11-07T20:41:09Z",
  body: "## Goal",
  url: "https://github.com/ivan-anchev/bb-plugins/pull/42",
  headRefName: "bb/add-summary-and-guide-tabs-thr_ejw2au8a9j",
  baseRefName: "main",
  state: "MERGED",
  isDraft: false,
  commits: [{ oid: "ec618b08a91e3f5e179ba46d1e43c6f6aeddfb53" }],
  additions: 310,
  deletions: 103,
  statusCheckRollup: [
    {
      __typename: "CheckRun",
      completedAt: "2026-11-08T06:48:06Z",
      conclusion: "SUCCESS",
      detailsUrl: "https://github.com/ivan-anchev/bb-plugins/actions/runs/42456126179/job/128655411994",
      name: "check",
      startedAt: "2026-11-08T06:46:50Z",
      status: "COMPLETED",
      workflowName: "CI",
    },
    {
      __typename: "StatusContext",
      context: "Devin Review",
      startedAt: "2026-11-08T06:47:58Z",
      state: "SUCCESS",
      targetUrl: "https://app.devin.ai/review/ivan-anchev/bb-plugins/pull/42",
    },
  ],
  reviewRequests: [],
  latestReviews: [review("devin-ai-integration", "COMMENTED")],
  labels: [],
};

function review(login: string, state: string) {
  return { author: { login }, authorAssociation: "NONE", body: "", commit: { oid: "" }, id: "", includesCreatedEdit: false, reactionGroups: [], state, submittedAt: "2026-11-07T20:59:18Z" };
}

const user = (login: string) => ({ __typename: "User", login });
const team = (name: string) => ({ __typename: "Team", name, slug: `ivan-anchev/${name.toLowerCase()}` });

test("maps PR #42: when it opened, its checks with names, outcomes and details pages, its commenting reviewer, no labels", () => {
  const pr = parsePrDetail(PR_42);
  assert.equal(pr.createdAt, "2026-11-07T20:41:09Z");
  assert.deepEqual(pr.checks, [
    { name: "check", outcome: "passing", url: "https://github.com/ivan-anchev/bb-plugins/actions/runs/42456126179/job/128655411994" },
    { name: "Devin Review", outcome: "passing", url: "https://app.devin.ai/review/ivan-anchev/bb-plugins/pull/42" },
  ]);
  assert.deepEqual(pr.reviewers, [{ kind: "user", login: "devin-ai-integration", status: "commented" }]);
  assert.deepEqual(pr.labels, []);
});

test("requested users and teams await review, ahead of those who reviewed", () => {
  const pr = parsePrDetail({
    ...PR_42,
    reviewRequests: [user("octocat"), team("Platform")],
    latestReviews: [review("alice", "APPROVED"), review("bob", "CHANGES_REQUESTED"), review("carol", "COMMENTED")],
  });
  assert.deepEqual(pr.reviewers, [
    { kind: "user", login: "octocat", status: "awaiting" },
    { kind: "team", name: "Platform" },
    { kind: "user", login: "alice", status: "approved" },
    { kind: "user", login: "bob", status: "changes-requested" },
    { kind: "user", login: "carol", status: "commented" },
  ]);
});

test("a reviewer re-requested after an older review awaits review, once", () => {
  const pr = parsePrDetail({ ...PR_42, reviewRequests: [user("alice")], latestReviews: [review("alice", "CHANGES_REQUESTED")] });
  assert.deepEqual(pr.reviewers, [{ kind: "user", login: "alice", status: "awaiting" }]);
});

test("a dismissed or draft review, a state GitHub adds later, and an unknown request kind drop out without failing the read", () => {
  const pr = parsePrDetail({
    ...PR_42,
    reviewRequests: [{ __typename: "Mannequin", login: "imported" }, user("octocat")],
    latestReviews: [review("dave", "DISMISSED"), review("erin", "PENDING"), review("frank", "BRAND_NEW_STATE"), review("alice", "APPROVED")],
  });
  assert.deepEqual(pr.reviewers, [
    { kind: "user", login: "octocat", status: "awaiting" },
    { kind: "user", login: "alice", status: "approved" },
  ]);
});

test("an open draft is a draft; a closed one is closed, as on GitHub", () => {
  const stateOf = (state: string, isDraft: boolean) => parsePrDetail({ ...PR_42, state, isDraft }).state;
  assert.deepEqual([stateOf("OPEN", false), stateOf("OPEN", true), stateOf("CLOSED", true), stateOf("MERGED", false)], ["OPEN", "DRAFT", "CLOSED", "MERGED"]);
});

test("labels keep their name and gain a CSS hex color", () => {
  const pr = parsePrDetail({
    ...PR_42,
    labels: [
      { id: "LA_1", name: "bug", description: "Something isn't working", color: "d73a4a" },
      { id: "LA_2", name: "good first issue", description: "", color: "7057FF" },
    ],
  });
  assert.deepEqual(pr.labels, [
    { name: "bug", color: "#d73a4a" },
    { name: "good first issue", color: "#7057FF" },
  ]);
});
