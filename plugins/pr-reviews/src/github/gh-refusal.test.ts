import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ghPostRefusalFor, ghRefusalFor, ghStateRefusalFor } from "./gh-refusal.ts";
import { parseHostCommandFailure, type HostCommandFailure } from "./host-command.ts";
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";

// Each fixture is the rejection of a real gh run against the throwaway PR #59 of
// ivan-anchev/bb-plugins (or a repo or PR that does not exist), or, for the state changes, against
// a merged PR of a throwaway repo since deleted, saved field for field: exit code, killed, stdout,
// stderr. Recorded with gh 2.97.0.
const recorded = (name: string) => parseHostCommandFailure(JSON.parse(readFileSync(new URL(`./fixtures/gh-failures/${name}.json`, import.meta.url), "utf8")));

const refusalOf = (refusalOrFailure: Refusal | HostCommandFailure) => {
  const refusal = refusalOrFailure instanceof Refusal ? refusalOrFailure : ghRefusalFor(refusalOrFailure);
  return { code: refusal.code, message: refusal.message };
};

test("gh not installed, and a comment too long for the OS to pass to it", () => {
  assert.deepEqual(refusalOf(recorded("not-installed")), {
    code: "invalid",
    message: "PR Reviews needs the GitHub CLI. Install gh and make sure it is on your PATH, then Refresh.",
  });
  assert.deepEqual(refusalOf(recorded("too-long-e2big")), { code: "invalid", message: "The comment is too long to pass to the GitHub CLI. Shorten it, or select fewer lines." });
});

test("no network", () => {
  assert.deepEqual(refusalOf(recorded("network")), { code: "invalid", message: "Couldn't reach GitHub. Check the connection and try again." });
});

test("not signed in, and a token GitHub refuses (401), both read as not signed in", () => {
  const notSignedIn = { code: "forbidden", message: "The GitHub CLI isn't signed in. Run `gh auth login`, then try again." };

  assert.deepEqual(refusalOf(recorded("not-signed-in")), notSignedIn);
  assert.deepEqual(refusalOf(recorded("unauthorized-401")), notSignedIn);
});

test("a repo the account can't see (404), and a PR number GitHub doesn't have", () => {
  const notFound = { code: "not_found", message: "GitHub has no such pull request, or your account can't see it." };

  assert.deepEqual(refusalOf(recorded("not-found-404")), notFound);
  assert.deepEqual(refusalOf(recorded("pr-view-not-found")), notFound);
});

test("a 422 gives GitHub's own words from its response, then the likely cause", () => {
  assert.deepEqual(refusalOf(recorded("line-not-in-diff-422")), {
    code: "invalid",
    message: "GitHub refused the comment: Validation Failed: pull_request_review_thread.line could not be resolved. The lines may no longer be in this commit's diff.",
  });
  assert.deepEqual(refusalOf(recorded("commit-not-in-pr-422")), {
    code: "invalid",
    message: "GitHub refused the comment: Validation Failed: commit_id is not part of the pull request. The lines may no longer be in this commit's diff.",
  });
});

test("a 422 with no response to read keeps gh's words, without its prefix and status", () => {
  const failure = parseHostCommandFailure({ code: 1, stderr: "gh: Validation Failed (HTTP 422)\n" });

  assert.equal(ghRefusalFor(failure).message, "GitHub refused the comment: Validation Failed. The lines may no longer be in this commit's diff.");
});

// Not recorded: the test account owns the repo, so GitHub lets it comment on a locked PR and never
// limits it in a test this size. These follow gh's "gh: <GitHub's message> (HTTP <status>)" shape.
test("a locked conversation, no permission, and rate limits (shape-only fixtures)", () => {
  const failure = (stderr: string) => parseHostCommandFailure({ code: 1, stderr });

  assert.deepEqual(refusalOf(failure("gh: Unable to create comment because issue is locked. (HTTP 403)\n")), {
    code: "forbidden",
    message: "This conversation is locked on GitHub, so only collaborators can comment.",
  });
  assert.deepEqual(refusalOf(failure("gh: Resource not accessible by personal access token (HTTP 403)\n")), {
    code: "forbidden",
    message: "Your GitHub account doesn't have permission to do that in this repository.",
  });
  const limited = { code: "invalid", message: "GitHub is limiting requests right now. Wait a minute and try again." };
  assert.deepEqual(refusalOf(failure("gh: API rate limit exceeded for user ID 1. (HTTP 403)\n")), limited);
  assert.deepEqual(refusalOf(failure("gh: You have exceeded a secondary rate limit. (HTTP 429)\n")), limited);
});

test("anything else shows gh's first line", () => {
  assert.equal(ghRefusalFor(parseHostCommandFailure({ code: 1, stderr: "\nsomething new went wrong\nmore\n" })).message, "something new went wrong");
});

test("a post the timeout stopped may have been posted: it says so, and a post that failed otherwise maps as any run", () => {
  assert.deepEqual(refusalOf(ghPostRefusalFor(recorded("timed-out"))), {
    code: "invalid",
    message: "GitHub didn't answer in time. The comment may have been posted: check the pull request before posting again.",
  });
  assert.deepEqual(refusalOf(ghPostRefusalFor(recorded("unauthorized-401"))), refusalOf(ghRefusalFor(recorded("unauthorized-401"))));
});

test("a state change the PR's state on GitHub no longer allows says why, without gh's mark", () => {
  const merged = { code: "invalid", message: "This pull request is already merged, so its state can't change. Refresh to see it." };

  assert.deepEqual(refusalOf(ghStateRefusalFor(recorded("close-merged"))), merged);
  assert.deepEqual(refusalOf(ghStateRefusalFor(recorded("reopen-merged"))), merged);
  assert.deepEqual(refusalOf(ghStateRefusalFor(recorded("draft-closed"))), {
    code: "invalid",
    message: "This pull request is closed on GitHub, so it can't be marked ready or converted to draft. Refresh to see it.",
  });
});

test("a state change the timeout stopped may have gone through: it says so; one that failed otherwise maps as any run", () => {
  assert.deepEqual(refusalOf(ghStateRefusalFor(recorded("timed-out"))), {
    code: "invalid",
    message: "GitHub didn't answer in time. The state may have changed: Refresh to check before trying again.",
  });
  for (const name of ["not-signed-in", "network", "pr-view-not-found"]) {
    assert.deepEqual(refusalOf(ghStateRefusalFor(recorded(name))), refusalOf(ghRefusalFor(recorded(name))));
  }
});

// Not recorded: every token at hand can change the throwaway repo's PRs. These follow the shape gh
// pr prints for a GraphQL error, "GraphQL: <GitHub's message> (<mutation>)", with no HTTP status.
test("no permission to change a PR's state (shape-only fixtures)", () => {
  const noPermission = { code: "forbidden", message: "Your GitHub account doesn't have permission to do that in this repository." };
  const failure = (stderr: string) => parseHostCommandFailure({ code: 1, stderr });

  assert.deepEqual(refusalOf(ghStateRefusalFor(failure("GraphQL: octocat does not have the correct permissions to execute `ClosePullRequest` (closePullRequest)\n"))), noPermission);
  assert.deepEqual(refusalOf(ghStateRefusalFor(failure("GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)\n"))), noPermission);
});

test("a gh pr failure nothing else matches shows its first line without gh's mark", () => {
  assert.equal(ghRefusalFor(parseHostCommandFailure({ code: 1, stderr: "X Pull request octo-org/widgets#7 can't be changed today\n" })).message, "Pull request octo-org/widgets#7 can't be changed today");
});
