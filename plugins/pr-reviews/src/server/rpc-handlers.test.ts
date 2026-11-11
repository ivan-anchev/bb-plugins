import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { CommentRequest } from "../comments/comment-schema.ts";
import { commentsTag, prReviewsContract } from "../contract.ts";

// GitHub stands in: each post records what it was asked, and its order against bb's invalidations.
const events: string[] = [];
const posted = (what: string) => async (...args: unknown[]) => {
  events.push(`${what} ${JSON.stringify(args)}`);
  return { url: `https://github.com/ivan-anchev/bb-plugins/pull/40#${what}` };
};
const notCalled = async () => assert.fail("not part of these tests");
mock.module("../github/gh.ts", {
  namedExports: {
    postComment: posted("comment"),
    postReply: posted("reply"),
    postConversationComment: posted("conversation"),
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
const READ_TAGS = prReviewsContract.comments.tags!(TARGET, { threads: [], timeline: [], changedPaths: [] });
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
