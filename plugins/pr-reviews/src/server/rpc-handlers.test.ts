import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import type { CommentRequest } from "../comments/comment-schema.ts";
import { commentsTag, prReviewsContract, repoTag } from "../contract.ts";
import { repoSchema } from "../github/repo.ts";

// GitHub stands in: each post records what it was asked, and its order against bb's invalidations.
const events: string[] = [];
const posted = (what: string) => async (...args: unknown[]) => {
  events.push(`${what} ${JSON.stringify(args)}`);
  return { url: `https://github.com/ivan-anchev/bb-plugins/pull/40#${what}` };
};
// A review write resolves to nothing, or fails as GitHub refused it while `refusing` is set.
let refusing: Refusal | null = null;
const wrote = (what: string) => async (...args: unknown[]) => {
  events.push(`${what} ${JSON.stringify(args)}`);
  if (refusing !== null) throw refusing;
};
const notCalled = async () => assert.fail("not part of these tests");
mock.module("../github/gh.ts", {
  namedExports: {
    postComment: posted("comment"),
    postReply: posted("reply"),
    postConversationComment: posted("conversation"),
    addReviewComment: wrote("add-to-review"),
    addReviewReply: wrote("reply-in-review"),
    submitReview: wrote("submit"),
    discardReview: wrote("discard"),
    readPrComments: notCalled,
    listOpenPrs: notCalled,
    readFileAt: notCalled,
    snapshotPrDiff: notCalled,
  },
});
const { createRpcHandlers } = await import("./rpc-handlers.ts");

const PROJECT = { id: "proj_1", name: "bb-plugins", gitRemoteUrl: "https://github.com/ivan-anchev/bb-plugins.git", sources: [] };

const handlersWith = (projects: (typeof PROJECT)[]) =>
  createRpcHandlers({
    bb: {
      sdk: { projects: { list: async () => projects } },
      rpc: { experimental_invalidate: (tags) => void events.push(`invalidate ${tags.join(",")}`) },
      storage: { kv: { get: notCalled, set: notCalled } },
    },
    store: { guide: () => assert.fail("not part of these tests"), snapshotFiles: () => assert.fail("not part of these tests") },
    reader: { withReviews: notCalled, pullRequest: notCalled, runningReview: notCalled, threadIsOpen: notCalled },
    reviews: { start: notCalled, update: notCalled, cancel: notCalled, nudge: notCalled, ask: notCalled, askAboutLines: notCalled, askAboutGitHubThread: notCalled },
  });
const handlers = handlersWith([PROJECT]);

const TARGET = { projectId: "proj_1", number: 40 };
// The tag the comments read carries for this PR: what each post must invalidate for it to show.
const READ_TAGS = prReviewsContract.comments.tags!(TARGET, { threads: [], timeline: [], changedPaths: [], viewer: { author: false, pendingReviewId: null } });
// The tag the PR read, which carries its reviewers' states, has for the project's repo.
const PR_TAG = repoTag(repoSchema.parse("ivan-anchev/bb-plugins"));
// The app calling, as the Changes tab and the guide do.
const FROM_APP = { experimental_caller: { kind: "client" }, experimental_signal: new AbortController().signal } as const;
const call = async <Input, Output>(handler: (input: Input, context: typeof FROM_APP) => Output | Promise<Output>, input: Input) => handler(input, FROM_APP);

test("the comments read is tagged per PR", () => {
  assert.deepEqual(READ_TAGS, [commentsTag(TARGET)]);
  assert.deepEqual(READ_TAGS, ["comments:proj_1#40"]);
});

test("a review comment, a reply and a conversation comment each post to the project's repo, then re-read the PR's comments", async () => {
  const request: CommentRequest = { kind: "line", commit: "ff2bc97", path: "src/a.ts", start: null, end: { side: "new", line: 12 }, body: "Why?" };
  events.length = 0;

  const results = [
    await call(handlers.postComment, { ...TARGET, request }),
    await call(handlers.replyToThread, { ...TARGET, commentId: 4523511788, body: "> Why?\n\nBecause." }),
    await call(handlers.postConversationComment, { ...TARGET, body: "> test\n\nThanks" }),
  ];

  assert.deepEqual(events, [
    `comment ${JSON.stringify(["ivan-anchev/bb-plugins", 40, request])}`,
    `invalidate ${READ_TAGS.join(",")}`,
    `reply ${JSON.stringify(["ivan-anchev/bb-plugins", 40, 4523511788, "> Why?\n\nBecause."])}`,
    `invalidate ${READ_TAGS.join(",")}`,
    `conversation ${JSON.stringify(["ivan-anchev/bb-plugins", 40, "> test\n\nThanks"])}`,
    `invalidate ${READ_TAGS.join(",")}`,
  ]);
  assert.deepEqual(
    results.map((result) => result.url),
    ["comment", "reply", "conversation"].map((what) => `https://github.com/ivan-anchev/bb-plugins/pull/40#${what}`),
  );
});

test("a project with no GitHub remote posts nothing and re-reads nothing", async () => {
  events.length = 0;

  await assert.rejects(call(handlersWith([]).replyToThread, { ...TARGET, commentId: 1, body: "x" }), /no GitHub remote/);
  assert.deepEqual(events, []);
});

test("a comment and a reply go into the pending review, each then re-reading the PR's comments; submitting or discarding it re-reads the PR too", async () => {
  const request: CommentRequest = { kind: "line", commit: "ff2bc97", path: "src/a.ts", start: { side: "new", line: 10 }, end: { side: "new", line: 12 }, body: "Why?" };
  events.length = 0;

  const results = [
    await call(handlers.addToReview, { ...TARGET, request, reviewId: null }),
    await call(handlers.addReplyToReview, { ...TARGET, threadId: "PRRT_1", reviewId: "PRR_1", body: "And this?" }),
    await call(handlers.submitReview, { ...TARGET, reviewId: "PRR_1", event: "REQUEST_CHANGES", body: "" }),
    await call(handlers.discardReview, { ...TARGET, reviewId: "PRR_2" }),
  ];

  assert.deepEqual(events, [
    `add-to-review ${JSON.stringify(["ivan-anchev/bb-plugins", 40, request, null])}`,
    `invalidate ${READ_TAGS.join(",")}`,
    `reply-in-review ${JSON.stringify(["PRRT_1", "PRR_1", "And this?"])}`,
    `invalidate ${READ_TAGS.join(",")}`,
    `submit ${JSON.stringify(["PRR_1", "REQUEST_CHANGES", ""])}`,
    `invalidate ${[...READ_TAGS, PR_TAG].join(",")}`,
    `discard ${JSON.stringify(["PRR_2"])}`,
    `invalidate ${[...READ_TAGS, PR_TAG].join(",")}`,
  ]);
  assert.deepEqual(results, [{}, {}, {}, {}]);
});

test("a comment GitHub refuses still re-reads the PR's comments, since a review may have gone pending elsewhere; a refused submit does not", async () => {
  const request: CommentRequest = { kind: "line", commit: "ff2bc97", path: "src/a.ts", start: null, end: { side: "new", line: 12 }, body: "Why?" };
  events.length = 0;
  refusing = new Refusal({ code: "invalid", message: "GitHub refused it: Could not resolve to a node with the global id of 'PRR_1'" });

  try {
    await assert.rejects(call(handlers.addToReview, { ...TARGET, request, reviewId: "PRR_1" }), /Could not resolve to a node/);
    await assert.rejects(call(handlers.submitReview, { ...TARGET, reviewId: "PRR_1", event: "COMMENT", body: "Looks good" }), /Could not resolve to a node/);
  } finally {
    refusing = null;
  }
  assert.deepEqual(events, [
    `add-to-review ${JSON.stringify(["ivan-anchev/bb-plugins", 40, request, "PRR_1"])}`,
    `invalidate ${READ_TAGS.join(",")}`,
    `submit ${JSON.stringify(["PRR_1", "COMMENT", "Looks good"])}`,
  ]);
});
