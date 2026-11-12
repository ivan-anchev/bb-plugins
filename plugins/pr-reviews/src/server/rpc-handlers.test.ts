import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import type { CommentRequest } from "../comments/comment-schema.ts";
import { lastOpenedProject } from "../app/last-opened.ts";
import { commentsTag, INBOX_TAG, prReviewsContract, repoTag, VISITS_TAG, type InboxPr, type Visit } from "../contract.ts";
import type { FoundPr } from "../github/inbox-search.ts";
import { repoSchema } from "../github/repo.ts";

// GitHub stands in: each post records what it was asked, and its order against bb's invalidations.
const events: string[] = [];
const posted = (what: string) => async (...args: unknown[]) => {
  events.push(`${what} ${JSON.stringify(args)}`);
  return { url: `https://github.com/ivan-anchev/bb-plugins/pull/40#${what}` };
};
const notCalled = async () => assert.fail("not part of these tests");
// PR 41 stands for one GitHub refuses to change.
const REFUSED_PR = 41;
const changedState = async (...args: [string, number, string]) => {
  events.push(`state ${JSON.stringify(args)}`);
  if (args[1] === REFUSED_PR) throw new Refusal({ code: "forbidden", message: "Your GitHub account doesn't have permission to do that in this repository." });
};
// The PRs GitHub's search finds, as the sidebar reads them.
let searchFinds: FoundPr[] = [];
// The visits the store was asked to save, in the order the writes landed.
const saved: Visit[] = [];
mock.module("../github/gh.ts", {
  namedExports: {
    postComment: posted("comment"),
    postReply: posted("reply"),
    postConversationComment: posted("conversation"),
    changePrState: changedState,
    readPrComments: notCalled,
    listOpenPrs: notCalled,
    readInbox: async () => ({ found: searchFinds, stackMates: [] }),
    readFileAt: notCalled,
    snapshotPrDiff: notCalled,
  },
});
const { createRpcHandlers } = await import("./rpc-handlers.ts");

const PROJECT = { id: "proj_1", name: "bb-plugins", gitRemoteUrl: "https://github.com/ivan-anchev/bb-plugins.git", sources: [] };

// The cleanup each set of handlers registered for when the plugin is disposed.
const disposeHooks: (() => void | Promise<void>)[] = [];
// `list`: bb's project list, read once per call that names a project.
const handlersWith = (projects: (typeof PROJECT)[], list: () => Promise<(typeof PROJECT)[]> = async () => projects) =>
  createRpcHandlers({
    bb: {
      sdk: { projects: { list } },
      rpc: { experimental_invalidate: (tags) => void events.push(`invalidate ${tags.join(",")}`) },
      onDispose: (hook) => void disposeHooks.push(hook),
    },
    store: {
      guide: () => assert.fail("not part of these tests"),
      snapshotFiles: () => assert.fail("not part of these tests"),
      saveVisit: (visit) => {
        saved.push(visit);
        events.push(`visit ${JSON.stringify(visit)}`);
      },
      visits: () => assert.fail("not part of these tests"),
    },
    reader: { withReviews: notCalled, pullRequest: notCalled, runningReview: notCalled, threadIsOpen: notCalled },
    reviews: { start: notCalled, update: notCalled, cancel: notCalled, nudge: notCalled, ask: notCalled, askAboutLines: notCalled, askAboutGitHubThread: notCalled },
  });
const handlers = handlersWith([PROJECT]);

const TARGET = { projectId: "proj_1", number: 40 };
// The target PR as GitHub's search reports it.
const pullRequest40 = {
  repo: repoSchema.parse("ivan-anchev/bb-plugins"),
  number: 40,
  title: "Change a PR's state",
  author: "octocat",
  state: "OPEN",
  updatedAt: "2026-11-12T10:00:00Z",
  mergedAt: null,
  baseRefName: "main",
  headRefName: "pr-state",
  ciFailing: false,
  changesRequested: false,
} as const satisfies FoundPr["pr"];
// The tag the comments read carries for this PR: what each post must invalidate for it to show.
const READ_TAGS = prReviewsContract.comments.tags!(TARGET, { threads: [], timeline: [], changedPaths: [] });
// The app calling, as the Changes tab and the guide do.
const FROM_APP = { experimental_caller: { kind: "client" }, experimental_signal: new AbortController().signal } as const;
const call = async <Input, Output>(handler: (input: Input, context: typeof FROM_APP) => Output | Promise<Output>, input: Input) => handler(input, FROM_APP);

test("the comments read is tagged per PR", () => {
  assert.deepEqual(READ_TAGS, [commentsTag(TARGET)]);
  assert.deepEqual(READ_TAGS, ["comments:proj_1#40"]);
});

test("the inbox lists GitHub's spelling of a repo under the tag a remote spelled otherwise invalidates", () => {
  const pr: InboxPr = {
    projectId: "proj_1",
    repo: repoSchema.parse("octo-org/widgets"),
    number: 7,
    title: "Add a widget",
    author: "octocat",
    state: "OPEN",
    updatedAt: "2026-11-12T10:00:00Z",
    mergedAt: null,
    baseRefName: "main",
    headRefName: "add-widget",
    ciFailing: false,
    changesRequested: false,
    section: "review",
  };
  const tags = prReviewsContract.inbox.tags!({}, { sections: [{ key: "review", count: 1, items: [{ kind: "pr", pr, stack: null }] }], unreadable: [] });
  assert.deepEqual(tags, [INBOX_TAG, repoTag(repoSchema.parse("Octo-Org/Widgets"))]);
});

test("an inbox that lists no PR keeps its own tag, so a state change still re-reads it", () => {
  assert.deepEqual(prReviewsContract.inbox.tags!({}, { sections: [], unreadable: [] }), [INBOX_TAG]);
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

test("a state change runs in the project's repo, re-reads the repo's PRs and the sidebar, and the sidebar again once search lists the new state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const plugin = handlersWith([PROJECT]);
  const searchLists = (state: InboxPr["state"]): FoundPr[] => [{ section: "authored", pr: { ...pullRequest40, state } }];
  const nextRead = async () => {
    t.mock.timers.tick(3_000);
    await new Promise(setImmediate);
  };
  events.length = 0;
  searchFinds = searchLists("OPEN");

  await call(plugin.changePrState, { ...TARGET, change: "draft" });
  assert.deepEqual(events, [`state ${JSON.stringify(["ivan-anchev/bb-plugins", 40, "draft"])}`, `invalidate ${repoTag(repoSchema.parse("ivan-anchev/bb-plugins"))},${INBOX_TAG}`]);

  await nextRead();
  assert.equal(events.length, 2);
  searchFinds = searchLists("DRAFT");
  await nextRead();
  assert.deepEqual(events.slice(2), [`invalidate ${INBOX_TAG}`]);
  await nextRead();
  assert.equal(events.length, 3);
});

test("disposing the plugin stops a state change's sidebar re-reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  disposeHooks.length = 0;
  const plugin = handlersWith([PROJECT]);
  events.length = 0;
  searchFinds = [{ section: "authored", pr: { ...pullRequest40, state: "CLOSED" } }];

  await call(plugin.changePrState, { ...TARGET, change: "close" });
  await Promise.all(disposeHooks.map((hook) => hook()));
  t.mock.timers.tick(3_000);
  await new Promise(setImmediate);

  assert.equal(disposeHooks.length, 1);
  assert.equal(events.length, 2);
});

test("a state change GitHub refuses re-reads nothing", async () => {
  events.length = 0;

  await assert.rejects(call(handlers.changePrState, { ...TARGET, number: REFUSED_PR, change: "close" }), /doesn't have permission/);
  assert.deepEqual(events, [`state ${JSON.stringify(["ivan-anchev/bb-plugins", REFUSED_PR, "close"])}`]);
});

test("opening a PR page records the visit in its project and the PR's repo, then re-reads the visits", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_794_480_000_000 });
  events.length = 0;

  await call(handlers.recordVisit, TARGET);

  assert.deepEqual(events, [
    `visit ${JSON.stringify({ projectId: "proj_1", repo: "ivan-anchev/bb-plugins", number: 40, openedAt: 1_794_480_000_000 })}`,
    `invalidate ${VISITS_TAG}`,
  ]);
});

test("a page opened first whose project reads slower records the earlier time, so the page opened last stays the badge's", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_794_480_000_000 });
  const other = { ...PROJECT, id: "proj_2", name: "widgets", gitRemoteUrl: "git@github.com:octo-org/widgets.git" };
  let releaseFirst = () => {};
  const firstRead = new Promise<(typeof PROJECT)[]>((resolve) => (releaseFirst = () => resolve([PROJECT, other])));
  const reads = [firstRead, Promise.resolve([PROJECT, other])];
  const slowFirst = handlersWith([], () => reads.shift() ?? assert.fail("read once per visit"));
  saved.length = 0;

  const first = call(slowFirst.recordVisit, TARGET);
  t.mock.timers.tick(5_000);
  await call(slowFirst.recordVisit, { projectId: "proj_2", number: 7 });
  t.mock.timers.tick(5_000);
  releaseFirst();
  await first;

  assert.deepEqual(
    saved.map(({ projectId, openedAt }) => [projectId, openedAt]),
    [
      ["proj_2", 1_794_480_005_000],
      ["proj_1", 1_794_480_000_000],
    ],
  );
  assert.equal(lastOpenedProject(saved), "proj_2");
});
