import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allPages, graphqlArgs, parseConversationPage, parseThreadsPage, prVariables, THREADS_QUERY, toThread } from "./pr-comments.ts";
import { repoSchema } from "./repo.ts";

// Real responses of THREADS_QUERY and CONVERSATION_QUERY for this repo, recorded with `gh api
// graphql`; PR #71's trimmed to its first four threads.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/comments/${name}.json`, import.meta.url), "utf8"));

const threadsOf = (name: string) => parseThreadsPage(fixture(name)).nodes.map((thread) => toThread(thread, thread.comments.nodes));

const HEAD_71 = "293f1268d74d8247f42a7103740395b8446f1fd9";
const WRITTEN_71 = "055a799ce211f989381a022b963c4c46002da9a0";

test("PR #71: a range from a removed line to an added one, at the head and where it was written", () => {
  const [range] = threadsOf("threads-71");

  assert.deepEqual(
    { ...range, comments: range.comments.map(({ body, ...comment }) => ({ ...comment, body: body.slice(0, 13) })) },
    {
      id: "PRRT_kwDOVjmb-s61nBuz",
      path: "plugins/pr-reviews/src/github/gh.ts",
      resolved: false,
      outdated: false,
      subject: {
        kind: "lines",
        anchors: [
          { commit: HEAD_71, start: { side: "old", line: 12 }, end: { side: "new", line: 13 } },
          { commit: WRITTEN_71, start: { side: "old", line: 12 }, end: { side: "new", line: 13 } },
        ],
      },
      comments: [
        {
          id: 4522558288,
          url: "https://github.com/ivan-anchev/bb-plugins/pull/71#discussion_r4522558288",
          author: "ivan-anchev",
          body: "Why halve it?",
          createdAt: "2026-11-10T08:20:27Z",
        },
      ],
    },
  );
});

test("PR #71: an outdated thread keeps only the lines it was written on", () => {
  const outdated = threadsOf("threads-71")[1];

  assert.equal(outdated.outdated, true);
  assert.deepEqual(outdated.subject, { kind: "lines", anchors: [{ commit: WRITTEN_71, start: { side: "new", line: 12 }, end: { side: "new", line: 13 } }] });
});

test("PR #71: a file thread is on the whole file, whatever line GitHub reports for it", () => {
  assert.deepEqual(threadsOf("threads-71")[2].subject, { kind: "file" });
});

test("PR #71: one removed line, which GitHub reports with its line as its start, has no start", () => {
  const anchors = threadsOf("threads-71")[3].subject;

  assert.deepEqual(anchors, {
    kind: "lines",
    anchors: [
      { commit: HEAD_71, start: null, end: { side: "old", line: 12 } },
      { commit: WRITTEN_71, start: null, end: { side: "old", line: 12 } },
    ],
  });
});

test("PR #40: threads written at the head have one anchor, a range or one line", () => {
  const head = "ff2bc97857da72054e99587086ddf022d0512df7";
  const anchors = threadsOf("threads-40").map((thread) => [thread.path, thread.subject]);

  assert.deepEqual(anchors, [
    ["plugins/generative-ui/src/agent/instructions.ts", { kind: "lines", anchors: [{ commit: head, start: { side: "new", line: 5 }, end: { side: "new", line: 12 } }] }],
    ["plugins/generative-ui/src/library.ts", { kind: "lines", anchors: [{ commit: head, start: { side: "new", line: 9 }, end: { side: "new", line: 13 } }] }],
    ["plugins/generative-ui/src/app/use-block-actions.ts", { kind: "lines", anchors: [{ commit: head, start: null, end: { side: "new", line: 19 } }] }],
  ]);
});

test("PR #40: the conversation's comments, as canonical comments", () => {
  assert.deepEqual(parseConversationPage(fixture("conversation-40")).nodes, [
    { id: 6719323092, url: "https://github.com/ivan-anchev/bb-plugins/pull/40#issuecomment-6719323092", author: "ivan-anchev", body: "test", createdAt: "2026-11-08T08:34:16Z" },
  ]);
});

test("a deleted account's comment is ghost's, as on GitHub", () => {
  const [thread] = parseThreadsPage(fixture("threads-40")).nodes;
  const [comment] = thread.comments.nodes;

  assert.equal(toThread(thread, [{ ...comment, author: null }]).comments[0].author, "ghost");
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
