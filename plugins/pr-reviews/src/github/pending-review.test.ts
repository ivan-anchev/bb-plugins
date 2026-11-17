import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { CommentRequest } from "../comments/comment-schema.ts";
import { addReplyArgs, addThreadArgs, discardArgs, parseAddedThread, parseViewerReview, submitArgs, viewerReviewArgs } from "./pending-review.ts";
import { liveComments, parseThreadsPage, toThread } from "./pr-comments.ts";
import { repoSchema } from "./repo.ts";

// Real responses from the private sandbox ivan-anchev/pr-reviews-review-mode-sandbox, recorded with
// `gh api graphql` and these builders. PR #1 is the reader's own; PR #2 is Dependabot's, where the
// reader started a pending review with a range comment and a reply, then discarded it.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/comments/sandbox-${name}.json`, import.meta.url), "utf8"));

const PR_ID = "PR_kwDOVq1kJs8AAAABObCbKQ";

// The variables after the query, as gh is given them.
const variablesOf = (args: string[]) => args.slice(4);

test("the reader's review: the author of their own PR, and a reviewer's pending review", () => {
  assert.deepEqual(parseViewerReview(fixture("viewer-review-author")), { author: true, pendingReviewId: null });
  assert.deepEqual(parseViewerReview(fixture("viewer-review-pending")), { author: false, pendingReviewId: "PRR_kwDOVq1kJs8AAAABXWhFPA" });
  assert.deepEqual(variablesOf(viewerReviewArgs(repoSchema.parse("ivan-anchev/pr-reviews-review-mode-sandbox"), 2)), ["-f", "owner=ivan-anchev", "-f", "name=pr-reviews-review-mode-sandbox", "-F", "number=2"]);
});

test("a pending comment and a pending reply read as pending, beside the published comments", () => {
  const threads = parseThreadsPage(fixture("threads-pending")).nodes.map((thread) => toThread(thread, liveComments(thread.comments.nodes)));
  const pendingOf = (id: string) => threads.find((thread) => thread.id === id)!.comments.map((comment) => [comment.body, comment.pending]);

  assert.deepEqual(pendingOf("PRRT_kwDOVq1kJs62QZ7i"), [
    ["c1", false],
    ["Pending reply", true],
  ]);
  assert.deepEqual(pendingOf("PRRT_kwDOVq1kJs62Q4Kl"), [["Pending range comment", true]]);
});

test("right after a discard, GitHub still serves the review's comments with no review: they are gone, and so is a thread left empty", () => {
  const page = parseThreadsPage(fixture("threads-discarded"));
  const live = page.nodes.flatMap((thread) => {
    const comments = liveComments(thread.comments.nodes);
    return comments.length === 0 ? [] : [toThread(thread, comments)];
  });

  assert.equal(page.nodes.length, 5, "GitHub still serves the discarded thread");
  assert.deepEqual(
    live.map((thread) => [thread.id, thread.comments.map((comment) => comment.body)]),
    [
      ["PRRT_kwDOVq1kJs62QZ7i", ["c1"]],
      ["PRRT_kwDOVq1kJs62QaSK", ["c"]],
      ["PRRT_kwDOVq1kJs62QaWH", ["c"]],
      ["PRRT_kwDOVq1kJs62QoCf", ["probe pending thread"]],
    ],
  );
});

test("a range comment goes into the reader's pending review, or starts one: GitHub's line fields, and no commit", () => {
  const request: CommentRequest = { kind: "line", commit: "1ac7a55", path: "gamma.txt", start: { side: "new", line: 15 }, end: { side: "new", line: 16 }, body: "@team Pending range comment" };

  assert.deepEqual(variablesOf(addThreadArgs(PR_ID, null, request)), [
    ...["-f", `pr=${PR_ID}`, "-f", "path=gamma.txt", "-f", "body=@team Pending range comment"],
    ...["-F", "line=16", "-f", "side=RIGHT", "-F", "startLine=15", "-f", "startSide=RIGHT"],
  ]);
  assert.deepEqual(variablesOf(addThreadArgs(PR_ID, "PRR_1", { ...request, start: null, end: { side: "old", line: 3 } })), [
    ...["-f", `pr=${PR_ID}`, "-f", "review=PRR_1", "-f", "path=gamma.txt", "-f", "body=@team Pending range comment"],
    ...["-F", "line=3", "-f", "side=LEFT"],
  ]);
});

test("a file comment goes into the review as a thread on the whole file", () => {
  const request: CommentRequest = { kind: "file", commit: "1ac7a55", path: "beta.txt", body: "Quoted lines" };

  assert.deepEqual(variablesOf(addThreadArgs(PR_ID, "PRR_1", request)), ["-f", `pr=${PR_ID}`, "-f", "review=PRR_1", "-f", "path=beta.txt", "-f", "body=Quoted lines", "-f", "subjectType=FILE"]);
});

test("GitHub placed the thread, or answered a line it couldn't place with no thread and no error", () => {
  assert.equal(parseAddedThread(fixture("added-thread")), true);
  assert.equal(parseAddedThread(fixture("added-thread-unplaced")), false);
});

test("a reply, a submit and a discard each name the pending review", () => {
  assert.deepEqual(variablesOf(addReplyArgs("PRRT_1", "PRR_1", "Pending reply")), ["-f", "thread=PRRT_1", "-f", "review=PRR_1", "-f", "body=Pending reply"]);
  assert.deepEqual(variablesOf(submitArgs("PRR_1", "REQUEST_CHANGES", "")), ["-f", "review=PRR_1", "-f", "event=REQUEST_CHANGES", "-f", "body="]);
  assert.deepEqual(variablesOf(discardArgs("PRR_1")), ["-f", "review=PRR_1"]);
});
