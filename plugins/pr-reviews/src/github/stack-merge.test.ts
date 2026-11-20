import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repoSchema } from "./repo.ts";
import { parsePrStack, parseStackMergeAnswer, pollMergeArgs, stacksArgs, submitMergeArgs } from "./stack-merge.ts";

const REPO = repoSchema.parse("ivan-anchev/bb-plugins");

// `gh api repos/ivan-anchev/bb-plugins/stacks?pull_request=192`, recorded once the whole stack had merged.
const STACK_193 = JSON.parse(readFileSync(new URL("./fixtures/stacks/stack-193.json", import.meta.url), "utf8"));
type Member = { number: number; state: string };

// The same stack while its PRs from `firstOpen` up were still open.
function openFrom(firstOpen: number) {
  const [stack] = STACK_193;
  return [{ ...stack, pull_requests: stack.pull_requests.map((pr: Member) => ({ ...pr, state: pr.number >= firstOpen ? "open" : "closed" })) }];
}

test("a stacked PR merges with every open PR below it, bottom first, onto the stack's base", () => {
  assert.deepEqual(parsePrStack(openFrom(184), 188), { number: 193, base: "main", merges: [184, 185, 186, 187, 188] });
});

test("the open bottom PR of a stack merges alone", () => {
  assert.deepEqual(parsePrStack(openFrom(184), 184)?.merges, [184]);
});

test("a PR GitHub lists in no stack is in none", () => {
  assert.equal(parsePrStack([], 40), null);
});

test("the stack read, the submit and the poll name the PR, and the submit pins the head the reader saw", () => {
  assert.deepEqual(stacksArgs(REPO, 192), ["api", "repos/ivan-anchev/bb-plugins/stacks?pull_request=192"]);
  assert.deepEqual(submitMergeArgs(REPO, 192, "squash", "abc123"), ["api", "--method", "PUT", "repos/ivan-anchev/bb-plugins/pulls/192/merge-async", "-f", "merge_method=squash", "-f", "sha=abc123"]);
  assert.deepEqual(pollMergeArgs(REPO, 192, "630b9d5e"), ["api", "repos/ivan-anchev/bb-plugins/pulls/192/merge-async/630b9d5e"]);
});

// The answers below are the merge API reference's own examples.
test("a running merge is polled by its uuid, including one GitHub already had running (409)", () => {
  const pending = JSON.stringify({ status: "pending", details: { message: "Merge request enqueued.", uuid: "630b9d5e-3f2a", merge_method: "squash", merge_action: "default", expected_head_sha: "6dcb09b5" } });
  assert.deepEqual(parseStackMergeAnswer(pending), { kind: "pending", uuid: "630b9d5e-3f2a" });
});

test("a merged stack, a queued one and a refused one each say so, a refusal in GitHub's words", () => {
  assert.deepEqual(parseStackMergeAnswer(JSON.stringify({ status: "merged", details: { message: "Pull request was merged.", sha: "6dcb09b5" } })), { kind: "done", outcome: "merged" });
  assert.deepEqual(parseStackMergeAnswer(JSON.stringify({ status: "enqueued", details: { message: "Pull request was added to the merge queue." } })), { kind: "done", outcome: "queued" });
  assert.deepEqual(parseStackMergeAnswer(JSON.stringify({ status: "failed", details: { message: "Merge conflict: the pull request could not be merged." } })), {
    kind: "failed",
    message: "Merge conflict: the pull request could not be merged.",
  });
});

test("output that isn't a merge answer, such as a 404's or none, is no answer", () => {
  assert.equal(parseStackMergeAnswer(JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest", status: "404" })), null);
  assert.equal(parseStackMergeAnswer(""), null);
});
