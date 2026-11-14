import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TimelineItem } from "../../comments/timeline-schema.ts";
import type { PrDetail } from "../../contract.ts";
import { parseThreadsPage, toThread } from "../../github/pr-comments.ts";
import { isReview, parseTimelinePage, toTimeline } from "../../github/pr-timeline.ts";
import { activityOf, connectorsOf, keyOf, timeOfLine, type ActivityPart } from "./activity-fold.ts";

// withastro/astro#18616 as recorded (github/fixtures/comments), parsed as gh.ts parses it.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../github/fixtures/comments/${name}.json`, import.meta.url), "utf8"));
const THREADS = parseThreadsPage(fixture("threads-astro-18616")).nodes.map((thread) => toThread(thread, thread.comments.nodes));
const NODES = parseTimelinePage(fixture("timeline-astro-18616")).nodes;
const TIMELINE = toTimeline(NODES, new Map(NODES.filter(isReview).map((review) => [review.id, review.comments.nodes.map((comment) => comment.databaseId)])), THREADS);

const MERGED_PR: Pick<PrDetail, "author" | "createdAt" | "state"> = { author: "florian-lefebvre", createdAt: "2026-11-04T09:00:00Z", state: "MERGED" };

// Each part as a short word, so the whole fold reads at a glance.
function partWord(part: ActivityPart): string {
  switch (part.kind) {
    case "opened":
      return `opened${part.draft ? " draft" : ""}`;
    case "commits":
    case "force-pushes":
    case "labels":
    case "review-requests":
    case "mentions":
      return `${part.kind} ×${part.items.length}`;
    case "label-pair":
      return `±${part.added.label.name}`;
    case "event":
      return part.item.kind;
    case "review":
      return `${part.review.comment.author.login} ${part.review.verdict} line`;
    case "review-message":
      return `${part.review.comment.author.login} ${part.review.verdict} message`;
    case "comment":
      return `${part.item.comment.author.login} comment`;
    case "merged":
      return "merged";
    default:
      return part satisfies never;
  }
}

test("astro#18616: the opened line, then messages on the page and every other change one line, a kind's run folded", () => {
  assert.deepEqual(activityOf(MERGED_PR, TIMELINE, THREADS).map(partWord), [
    // Marked ready for review later, so it opened as a draft.
    "opened draft",
    "commits ×1",
    "changeset-bot comment",
    "commits ×1",
    "±pr: astro-review",
    // A bot's findings, their threads all resolved: a line.
    "astro-factory commented line",
    "commits ×1",
    "±pr: astro-review",
    "astro-factory commented line",
    "labels ×1",
    "commits ×1",
    "±pr: astro-review",
    "astro-factory commented line",
    "commits ×1",
    "±pr: astro-review",
    "astro-factory commented line",
    "commits ×2",
    "renamed",
    "codspeed comment",
    "status",
    // An open thread keeps a review on the page.
    "ematipico commented message",
    "florian-lefebvre comment",
    "ematipico comment",
    "ematipico approved line",
    "matthewp comment",
    "matthewp comment",
    "matthewp approved line",
    "florian-lefebvre comment",
    // The close the merge caused is the merge's.
    "merged",
    "mentions ×1",
  ]);
});

// Small timelines, built as the parse builds them.
const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, "0")}:00Z`;
const OPEN_PR: Pick<PrDetail, "author" | "createdAt" | "state"> = { author: "marlin", createdAt: at(0), state: "OPEN" };
const commit = (id: string, minute: number): TimelineItem => ({ kind: "commit", id, sha: `${id}0000000`, headline: id, url: "", createdAt: at(minute) });
const forcePush = (id: string, actor: string, minute: number): TimelineItem => ({ kind: "force-pushed", id, actor, createdAt: at(minute), before: null, after: null });
const label = (id: string, actor: string, added: boolean, name: string, minute: number): TimelineItem => ({ kind: "labeled", id, actor, createdAt: at(minute), added, label: { name, color: "#ffffff" } });
const request = (id: string, requested: boolean, reviewer: string, minute: number): TimelineItem => ({ kind: "review-requested", id, actor: "marlin", createdAt: at(minute), requested, reviewer });
const mention = (id: string, actor: string, minute: number): TimelineItem => ({ kind: "referenced", id, actor, createdAt: at(minute), ref: `#${minute}`, title: "Track it", url: "" });
const rename = (id: string, minute: number): TimelineItem => ({ kind: "renamed", id, actor: "marlin", createdAt: at(minute), from: "a", to: "b" });
const status = (id: string, change: Extract<TimelineItem, { kind: "status" }>["status"], minute: number): TimelineItem => ({ kind: "status", id, actor: "marlin", createdAt: at(minute), status: change });
const comment = (id: string, minute: number): TimelineItem => ({
  kind: "comment",
  id,
  comment: { id: minute, url: "", author: { login: "jun-park", bot: false }, body: "Looks good", createdAt: at(minute) },
});

// The parts after the opened line.
const foldOf = (timeline: TimelineItem[]) => activityOf(OPEN_PR, timeline, []).slice(1).map(partWord);

test("a run of commits folds to one line, as do one person's force-pushes, labels, requests and mentions", () => {
  assert.deepEqual(foldOf([commit("c1", 1), commit("c2", 2), commit("c3", 3)]), ["commits ×3"]);
  assert.deepEqual(foldOf([forcePush("f1", "marlin", 1), forcePush("f2", "marlin", 2), forcePush("f3", "jun-park", 3)]), ["force-pushes ×2", "force-pushes ×1"]);
  assert.deepEqual(foldOf([label("l1", "marlin", true, "wip", 1), label("l2", "marlin", false, "ci", 2)]), ["labels ×2"]);
  assert.deepEqual(foldOf([request("q1", true, "jun-park", 1), request("q2", true, "okafor-t", 2), request("q3", false, "okafor-t", 3)]), ["review-requests ×2", "review-requests ×1"]);
  assert.deepEqual(foldOf([mention("x1", "lumen-bot", 1), mention("x2", "lumen-bot", 2), mention("x3", "marlin", 3)]), ["mentions ×2", "mentions ×1"]);
});

test("only consecutive changes of a kind fold: another kind or a message between them starts a new line", () => {
  assert.deepEqual(foldOf([commit("c1", 1), forcePush("f1", "marlin", 2), commit("c2", 3)]), ["commits ×1", "force-pushes ×1", "commits ×1"]);
  assert.deepEqual(foldOf([commit("c1", 1), comment("m1", 2), commit("c2", 3)]), ["commits ×1", "jun-park comment", "commits ×1"]);
});

test("a title change or a state change is always a line of its own", () => {
  assert.deepEqual(foldOf([rename("n1", 1), rename("n2", 2), status("s1", "closed", 3), status("s2", "reopened", 4)]), ["renamed", "renamed", "status", "status"]);
});

test("only a label added then removed pairs, and a pair is a line apart from the labels around it", () => {
  assert.deepEqual(foldOf([label("a", "bot", false, "ci", 1), label("b", "bot", true, "ci", 2)]), ["labels ×2"]);
  assert.deepEqual(foldOf([label("a", "bot", true, "ci", 1), commit("c", 2), label("b", "bot", false, "ci", 3), label("d", "bot", false, "ci", 4)]), ["±ci", "commits ×1", "labels ×1"]);
  assert.deepEqual(foldOf([label("a", "bot", true, "wip", 1), label("b", "bot", true, "ci", 2), label("c", "bot", false, "ci", 3)]), ["labels ×1", "±ci"]);
});

test("a fold keeps its first item's key as it grows, so a line the reader opened stays open on a refresh", () => {
  const keysOf = (timeline: TimelineItem[]) => activityOf(OPEN_PR, timeline, []).map(keyOf);

  assert.deepEqual(keysOf([commit("c1", 1), commit("c2", 2)]), ["opened", "c1"]);
  assert.deepEqual(keysOf([commit("c1", 1), commit("c2", 2), commit("c3", 3)]), ["opened", "c1"]);
});

test("the opened line is the author's at the PR's creation, a draft only when the timeline or the PR says so", () => {
  const openedOf = (state: PrDetail["state"], timeline: TimelineItem[]) => activityOf({ ...OPEN_PR, state }, timeline, [])[0];
  const draftOf = (state: PrDetail["state"], timeline: TimelineItem[]) => {
    const opened = openedOf(state, timeline);
    return opened.kind === "opened" && opened.draft;
  };

  assert.deepEqual(openedOf("OPEN", []), { kind: "opened", author: "marlin", createdAt: at(0), draft: false });
  assert.equal(draftOf("DRAFT", []), true);
  assert.equal(draftOf("OPEN", [status("s1", "ready-for-review", 1)]), true);
  // Marked a draft first, so it opened ready, though it is a draft now.
  assert.equal(draftOf("DRAFT", [status("s1", "draft", 1), status("s2", "ready-for-review", 2), status("s3", "draft", 3)]), false);
  // Merged with no mark either way: it may have opened as a draft, so the line does not say.
  assert.equal(draftOf("MERGED", []), false);
});

test("a line's time is its latest item's, a label pair's its removal", () => {
  const [, commits, pair] = activityOf(OPEN_PR, [commit("c1", 3), commit("c2", 5), label("a", "bot", true, "ci", 6), label("b", "bot", false, "ci", 9)], []);

  assert.equal(commits.kind === "commits" && timeOfLine(commits), at(5));
  assert.equal(pair.kind === "label-pair" && timeOfLine(pair), at(9));
});

test("the connector joins neighbouring lines and stops above and below every message", () => {
  const parts = activityOf(OPEN_PR, [commit("c1", 1), forcePush("f1", "marlin", 2), comment("m1", 3), rename("n1", 4), comment("m2", 5)], []);

  assert.deepEqual(connectorsOf(parts), [
    { up: false, down: true },
    { up: true, down: true },
    { up: true, down: false },
    null,
    { up: false, down: false },
    null,
  ]);
});

test("a review whose threads a refresh reopens reads as a message again, under the same key", () => {
  const review = TIMELINE.find((item) => item.kind === "review")!;
  const reopened = THREADS.map((thread) => ({ ...thread, resolvedBy: null }));
  const partOf = (threads: typeof THREADS) => activityOf(OPEN_PR, [review], threads).slice(1).map((part) => [keyOf(part), partWord(part)]);

  assert.deepEqual(partOf(THREADS), [[review.id, "astro-factory commented line"]]);
  assert.deepEqual(partOf(reopened), [[review.id, "astro-factory commented message"]]);
});
