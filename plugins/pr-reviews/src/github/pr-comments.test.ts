import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allPages, graphqlArgs, parseChangedPathsPage, parseThreadsPage, prVariables, THREADS_QUERY, toThread } from "./pr-comments.ts";
import type { ReviewThread } from "../comments/thread-schema.ts";
import { repoSchema } from "./repo.ts";

// Real responses of THREADS_QUERY for this repo, recorded with `gh api graphql`; PR #71's trimmed
// to its first four threads.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/comments/${name}.json`, import.meta.url), "utf8"));

const threadsOf = (name: string) => parseThreadsPage(fixture(name)).nodes.map((thread) => toThread(thread, thread.comments.nodes));

const HEAD_71 = "293f1268d74d8247f42a7103740395b8446f1fd9";
const WRITTEN_71 = "055a799ce211f989381a022b963c4c46002da9a0";

// A thread's subject without its excerpt, which its own tests cover.
const anchorsOf = (thread: ReviewThread) => (thread.subject.kind === "lines" ? thread.subject.anchors : null);
const excerptOf = (thread: ReviewThread) => (thread.subject.kind === "lines" ? thread.subject.excerpt : null);

test("PR #71: a range from a removed line to an added one, at the head and where it was written", () => {
  const [range] = threadsOf("threads-71");

  assert.deepEqual(
    { ...range, subject: range.subject.kind, comments: range.comments.map(({ body, ...comment }) => ({ ...comment, body: body.slice(0, 13) })) },
    {
      id: "PRRT_kwDOVjmb-s61nBuz",
      path: "plugins/pr-reviews/src/github/gh.ts",
      resolvedBy: null,
      outdated: false,
      subject: "lines",
      comments: [
        {
          id: 4522558288,
          url: "https://github.com/ivan-anchev/bb-plugins/pull/71#discussion_r4522558288",
          author: { login: "ivan-anchev", bot: false },
          body: "Why halve it?",
          createdAt: "2026-11-10T08:20:27Z",
          pending: false,
        },
      ],
    },
  );
  assert.deepEqual(anchorsOf(range), [
    { commit: HEAD_71, start: { side: "old", line: 12 }, end: { side: "new", line: 13 } },
    { commit: WRITTEN_71, start: { side: "old", line: 12 }, end: { side: "new", line: 13 } },
  ]);
});

test("PR #71: a range's excerpt is its lines as GitHub kept them, from its start line to its last", () => {
  assert.deepEqual(excerptOf(threadsOf("threads-71")[0]), [
    { text: "-const LIST_LIMIT = 200;", old: 12, new: null },
    { text: '+// Cap the sidebar list: PRs past the 100th page in from "Load more".', old: null, new: 12 },
    { text: "+const LIST_LIMIT = 100;", old: null, new: 13 },
  ]);
});

test("PR #71: an outdated thread keeps only the lines it was written on, and their excerpt", () => {
  const outdated = threadsOf("threads-71")[1];

  assert.equal(outdated.outdated, true);
  assert.deepEqual(anchorsOf(outdated), [{ commit: WRITTEN_71, start: { side: "new", line: 12 }, end: { side: "new", line: 13 } }]);
  assert.deepEqual(excerptOf(outdated)?.map((line) => line.new), [12, 13]);
});

test("PR #71: a file thread is on the whole file, whatever line GitHub reports for it", () => {
  assert.deepEqual(threadsOf("threads-71")[2].subject, { kind: "file" });
});

test("PR #71: one removed line, which GitHub reports with its line as its start, has no start, and its excerpt is the last four lines up to it", () => {
  const [, , , oneLine] = threadsOf("threads-71");

  assert.deepEqual(anchorsOf(oneLine), [
    { commit: HEAD_71, start: null, end: { side: "old", line: 12 } },
    { commit: WRITTEN_71, start: null, end: { side: "old", line: 12 } },
  ]);
  assert.deepEqual(
    excerptOf(oneLine)?.map(({ old, new: next }) => `${old ?? "·"}/${next ?? "·"}`),
    ["9/9", "10/10", "11/11", "12/·"],
  );
});

test("PR #40: threads written at the head have one anchor, a range or one line", () => {
  const head = "ff2bc97857da72054e99587086ddf022d0512df7";

  assert.deepEqual(
    threadsOf("threads-40").map((thread) => [thread.path, anchorsOf(thread)]),
    [
      ["plugins/generative-ui/src/agent/instructions.ts", [{ commit: head, start: { side: "new", line: 5 }, end: { side: "new", line: 12 } }]],
      ["plugins/generative-ui/src/library.ts", [{ commit: head, start: { side: "new", line: 9 }, end: { side: "new", line: 13 } }]],
      ["plugins/generative-ui/src/app/use-block-actions.ts", [{ commit: head, start: null, end: { side: "new", line: 19 } }]],
    ],
  );
});

test("an open thread has no resolver; a resolved one names who resolved it, ghost when that account is gone", () => {
  const [thread] = parseThreadsPage(fixture("threads-40")).nodes;
  const resolverOf = (isResolved: boolean, resolvedBy: { login: string } | null) => toThread({ ...thread, isResolved, resolvedBy }, thread.comments.nodes).resolvedBy;

  assert.deepEqual([resolverOf(false, null), resolverOf(true, { login: "octocat" }), resolverOf(true, null)], [null, "octocat", "ghost"]);
});

test("a deleted account's comment is ghost's, as on GitHub, and an app's is a bot's", () => {
  const [thread] = parseThreadsPage(fixture("threads-40")).nodes;
  const [comment] = thread.comments.nodes;
  // The author GitHub gives Devin's review on PR #42.
  const bot = { __typename: "Bot", login: "devin-ai-integration" };

  assert.deepEqual(
    toThread(thread, [{ ...comment, author: null }, { ...comment, author: bot }]).comments.map((each) => each.author),
    [
      { login: "ghost", bot: false },
      { login: "devin-ai-integration", bot: true },
    ],
  );
});

test("allPages reads from the first page on, cursor by cursor, until GitHub says there are no more", async () => {
  const pages = new Map([
    [null, { pageInfo: { hasNextPage: true, endCursor: "a" }, nodes: [1, 2] }],
    ["a", { pageInfo: { hasNextPage: true, endCursor: "b" }, nodes: [3] }],
    ["b", { pageInfo: { hasNextPage: false, endCursor: "b" }, nodes: [4] }],
  ]);
  const asked: (string | null)[] = [];
  const read = async (cursor: string | null) => {
    asked.push(cursor);
    return pages.get(cursor)!;
  };

  assert.deepEqual(await allPages(null, read), [1, 2, 3, 4]);
  assert.deepEqual(asked, [null, "a", "b"]);
  asked.length = 0;
  assert.deepEqual(await allPages(pages.get("a")!, read), [3, 4], "a page already read is not read again");
  assert.deepEqual(asked, ["b"]);
});

test("graphql args: the query and text by -f, the PR number by -F, and no cursor on the first page", () => {
  const pr = prVariables(repoSchema.parse("ivan-anchev/bb-plugins"), 71);

  assert.deepEqual(graphqlArgs(THREADS_QUERY, { ...pr, cursor: null }), [
    ...["api", "graphql", "-f", `query=${THREADS_QUERY}`],
    ...["-f", "owner=ivan-anchev", "-f", "name=bb-plugins", "-F", "number=71"],
  ]);
  assert.deepEqual(graphqlArgs(THREADS_QUERY, { ...pr, cursor: "Y3Vyc29y" }).slice(-2), ["-f", "cursor=Y3Vyc29y"]);
});

// withastro/astro#18616's CHANGED_PATHS_QUERY, recorded with `gh api graphql`.
test("changed paths: each file the PR changes by its path, as GitHub names it", () => {
  const page = parseChangedPathsPage(fixture("files-astro-18616"));
  assert.equal(page.pageInfo.hasNextPage, false);
  assert.deepEqual(
    page.nodes.map((file) => file.path),
    [
      ".changeset/true-parks-retire.md",
      "packages/astro/package.json",
      "packages/astro/src/cli/add/index.ts",
      "packages/astro/src/cli/definitions.ts",
      "packages/astro/src/cli/dev/index.ts",
      "packages/astro/src/cli/flags.ts",
      "packages/astro/src/cli/index.ts",
      "packages/astro/src/cli/infra/mri-cli-argument-parser.ts",
      "packages/astro/src/events/session.ts",
      "packages/astro/test/units/cli/argument-parser.contract.ts",
      "packages/astro/test/units/cli/argument-parser.test.ts",
      "pnpm-lock.yaml",
    ],
  );
});
