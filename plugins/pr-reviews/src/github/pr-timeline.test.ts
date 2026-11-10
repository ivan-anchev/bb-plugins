import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TimelineItem } from "../comments/timeline-schema.ts";
import { parseThreadsPage, toThread } from "./pr-comments.ts";
import { isReview, parseReviewCommentsPage, parseTimelinePage, toTimeline, type GhTimelineNode } from "./pr-timeline.ts";

// Real responses of TIMELINE_QUERY and THREADS_QUERY, recorded with `gh api graphql`: this repo's
// PR #40, and withastro/astro#18616, a merged PR with every kind of activity.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/comments/${name}.json`, import.meta.url), "utf8"));

const nodesOf = (name: string) => parseTimelinePage(fixture(name)).nodes;
const threadsOf = (name: string) => parseThreadsPage(fixture(name)).nodes.map((thread) => toThread(thread, thread.comments.nodes));
// Each review's comment ids from its first page, as gh.ts reads them when there is no other page.
const firstPages = (nodes: GhTimelineNode[]) => new Map(nodes.filter(isReview).map((review) => [review.id, review.comments.nodes.map((comment) => comment.databaseId)]));
const timelineOf = (name: string, threads: string) => {
  const nodes = nodesOf(name);
  return toTimeline(nodes, firstPages(nodes), threadsOf(threads));
};

const ASTRO = () => timelineOf("timeline-astro-18616", "threads-astro-18616");
const ofKind = <Kind extends TimelineItem["kind"]>(items: TimelineItem[], kind: Kind) => items.filter((item): item is Extract<TimelineItem, { kind: Kind }> => item.kind === kind);

test("astro#18616: every item of the timeline, in GitHub's order, as its canonical kind", () => {
  const items = ASTRO();

  assert.equal(items.length, nodesOf("timeline-astro-18616").length);
  assert.deepEqual(
    items.map((item) => item.kind),
    [
      ...["commit", "comment", "commit", "labeled", "labeled", "review", "commit", "labeled", "labeled", "review", "labeled", "commit", "labeled", "labeled"],
      ...["review", "commit", "labeled", "labeled", "review", "commit", "commit", "renamed", "comment", "status", "review", "comment", "comment", "review"],
      ...["comment", "comment", "review", "comment", "merged", "status", "referenced"],
    ],
  );
});

test("astro#18616: a commit, a bot's comment, and a label added then removed", () => {
  const items = ASTRO();
  const [commit] = ofKind(items, "commit");
  const [bot] = ofKind(items, "comment");
  const [added, removed] = ofKind(items, "labeled");

  assert.deepEqual(commit, {
    kind: "commit",
    id: "PURC_lADOFL76Q88AAAABM1MbNdoAKGIyYmZkMjM5ZmQ5NzdlZWIyZDFlZjQ4NzkwMGQ3OWQwNTYwMGQ2NjE",
    sha: "b2bfd239fd977eeb2d1ef487900d79d05600d661",
    headline: "chore: replace yargs with mri",
    url: "https://github.com/withastro/astro/pull/18616/commits/b2bfd239fd977eeb2d1ef487900d79d05600d661",
    createdAt: "2026-11-04T14:33:37Z",
  });
  assert.deepEqual({ ...bot.comment, body: bot.comment.body.slice(0, 24) }, {
    id: 6633366163,
    url: "https://github.com/withastro/astro/pull/18616#issuecomment-6633366163",
    author: { login: "changeset-bot", bot: true },
    body: "### 🦋 Changeset detecte",
    createdAt: "2026-11-04T14:34:04Z",
  });
  assert.deepEqual(
    [added, removed].map(({ id, ...event }) => event),
    [
      { kind: "labeled", actor: "florian-lefebvre", createdAt: "2026-11-04T14:36:07Z", added: true, label: { name: "pr: astro-review", color: "#c2e0c6" } },
      { kind: "labeled", actor: "astro-factory", createdAt: "2026-11-04T14:36:18Z", added: false, label: { name: "pr: astro-review", color: "#c2e0c6" } },
    ],
  );
});

test("astro#18616: each review names the threads its comments are in; an approval with no body has none", () => {
  const items = ASTRO();
  const threads = threadsOf("threads-astro-18616");
  const reviews = ofKind(items, "review");

  assert.deepEqual(
    reviews.map((review) => [review.comment.author.login, review.verdict, review.comment.body === "", review.threadIds.map((id) => threads.findIndex((thread) => thread.id === id))]),
    [
      ["astro-factory", "commented", false, [0]],
      ["astro-factory", "commented", false, [1]],
      ["astro-factory", "commented", false, [2]],
      ["astro-factory", "commented", false, [3]],
      ["ematipico", "commented", false, [4]],
      ["ematipico", "approved", true, []],
      ["matthewp", "approved", true, []],
    ],
  );
  assert.equal(reviews[0].comment.createdAt, "2026-11-04T14:37:43Z", "a review's time is when it was submitted");
  assert.equal(reviews[0].comment.url, "https://github.com/withastro/astro/pull/18616#pullrequestreview-5770155200");
});

test("astro#18616: a title change, ready for review, the merge, the close it caused, and a mention", () => {
  const strip = ({ id, createdAt, ...event }: TimelineItem & { createdAt: string }) => event;
  const items = ASTRO().filter((item) => item.kind !== "comment" && item.kind !== "review" && item.kind !== "commit" && item.kind !== "labeled");

  assert.deepEqual(items.map(strip), [
    { kind: "renamed", actor: "florian-lefebvre", from: "Replace yargs with mri for CLI argument parsing", to: "Use mri for Astro CLI argument parsing" },
    { kind: "status", actor: "florian-lefebvre", status: "ready-for-review" },
    { kind: "merged", actor: "florian-lefebvre", base: "main" },
    { kind: "status", actor: "florian-lefebvre", status: "closed" },
    { kind: "referenced", actor: "astrobot-houston", ref: "#18643", title: "[ci] release", url: "https://github.com/withastro/astro/pull/18643" },
  ]);
});

test("PR #40: a conversation comment, as a canonical comment", () => {
  const [comment] = ofKind(timelineOf("timeline-40", "threads-40"), "comment");

  assert.deepEqual(comment.comment, {
    id: 6719323092,
    url: "https://github.com/ivan-anchev/bb-plugins/pull/40#issuecomment-6719323092",
    author: { login: "ivan-anchev", bot: false },
    body: "test",
    createdAt: "2026-11-08T08:34:16Z",
  });
});

test("a review's comments past its first page still name their threads", () => {
  const nodes = nodesOf("timeline-astro-18616");
  const threads = threadsOf("threads-astro-18616");
  const [first] = nodes.filter(isReview);
  // The fifth thread's comment, as REVIEW_COMMENTS_QUERY would page it in.
  const later = parseReviewCommentsPage({ data: { node: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ databaseId: threads[4].comments[0].id }] } } } });
  const comments = new Map([[first.id, [...first.comments.nodes, ...later.nodes].map((comment) => comment.databaseId)]]);
  const [review] = ofKind(toTimeline([first], comments, threads), "review");

  assert.deepEqual(review.threadIds, [threads[0].id, threads[4].id]);
});

test("a pending review, the reader's own draft, is left out", () => {
  const nodes = nodesOf("timeline-astro-18616");
  const pending = nodes.filter(isReview).map((review) => ({ ...review, state: "PENDING" as const, submittedAt: null }));

  assert.deepEqual(toTimeline(pending, firstPages(pending), []), []);
});

test("a team's review request names the team, a deleted actor is ghost, and a mention from another repo names it", () => {
  const event = { id: "E", createdAt: "2026-11-05T13:20:04Z", actor: null };
  const page = {
    data: {
      repository: {
        pullRequest: {
          timelineItems: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { __typename: "ReviewRequestedEvent", ...event, requestedReviewer: { name: "maintainers" } },
              { __typename: "ReviewRequestRemovedEvent", ...event, requestedReviewer: { login: "matthewp" } },
              {
                __typename: "CrossReferencedEvent",
                ...event,
                isCrossRepository: true,
                source: { number: 7, title: "Bump astro", url: "https://github.com/withastro/docs/pull/7", repository: { nameWithOwner: "withastro/docs" } },
              },
              { __typename: "HeadRefForcePushedEvent", ...event, beforeCommit: null, afterCommit: { oid: "abc" } },
            ],
          },
        },
      },
    },
  };
  const nodes = parseTimelinePage(page).nodes;

  assert.deepEqual(toTimeline(nodes, new Map(), []), [
    { kind: "review-requested", id: "E", createdAt: event.createdAt, actor: "ghost", requested: true, reviewer: "maintainers" },
    { kind: "review-requested", id: "E", createdAt: event.createdAt, actor: "ghost", requested: false, reviewer: "matthewp" },
    { kind: "referenced", id: "E", createdAt: event.createdAt, actor: "ghost", ref: "withastro/docs#7", title: "Bump astro", url: "https://github.com/withastro/docs/pull/7" },
    { kind: "force-pushed", id: "E", createdAt: event.createdAt, actor: "ghost", before: null, after: "abc" },
  ]);
});
