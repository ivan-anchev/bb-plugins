import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ReviewThread } from "../../comments/thread-schema.ts";
import type { TimelineItem } from "../../comments/timeline-schema.ts";
import { parseThreadsPage, toThread } from "../../github/pr-comments.ts";
import { activityOf, type ActivityLine } from "./activity-fold.ts";
import { foldItemsOf, threadLocationOf, threadStateOf, wordsOf, type Word } from "./activity-words.ts";

// A sentence as it reads, a sha short as the line draws it.
const textOf = (words: Word[]) => words.map((word) => (typeof word === "string" ? word : word.kind === "sha" ? word.sha.slice(0, 7) : word.kind === "label" ? word.label.name : word.text)).join("");

const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, "0")}:00Z`;
const commit = (id: string, minute: number): TimelineItem => ({ kind: "commit", id, sha: `${id}a1b2c3d4e5`, headline: `Commit ${id}`, url: `https://github.com/lumen-ui/lumen/commit/${id}`, createdAt: at(minute) });
const forcePush = (id: string, before: string | null, after: string | null, minute: number): TimelineItem => ({ kind: "force-pushed", id, actor: "marlin", createdAt: at(minute), before, after });
const label = (id: string, actor: string, added: boolean, name: string, minute: number): TimelineItem => ({ kind: "labeled", id, actor, createdAt: at(minute), added, label: { name, color: "#ffffff" } });
const request = (id: string, requested: boolean, reviewer: string): TimelineItem => ({ kind: "review-requested", id, actor: "marlin", createdAt: at(1), requested, reviewer });
const mention = (id: string, minute: number): TimelineItem => ({ kind: "referenced", id, actor: "okafor-t", createdAt: at(minute), ref: `#14${minute}`, title: "Table performance", url: "" });

// The lines a timeline folds to, after the opened line, as text.
const linesOf = (timeline: TimelineItem[], draft = false) =>
  activityOf({ author: "marlin", createdAt: at(0), state: draft ? "DRAFT" : "OPEN" }, timeline, []).filter((part): part is ActivityLine => part.kind !== "comment" && part.kind !== "review-message");
const sentencesOf = (timeline: TimelineItem[]) => linesOf(timeline).slice(1).map((line) => textOf(wordsOf(line)));

test("the opened line names its author, and a draft only when it opened as one", () => {
  assert.equal(textOf(wordsOf(linesOf([])[0])), "Opened by marlin");
  assert.equal(textOf(wordsOf(linesOf([], true)[0])), "Opened as a draft by marlin");
});

test("commits name no one: one says its sha and headline, more say how many", () => {
  assert.deepEqual(sentencesOf([commit("c1", 1)]), ["Pushed c1a1b2c Commit c1"]);
  assert.deepEqual(sentencesOf([commit("c1", 1), commit("c2", 2), commit("c3", 3)]), ["Pushed 3 commits"]);
});

test("force-pushes say their shas when there is one, and how many when there are more", () => {
  assert.deepEqual(sentencesOf([forcePush("f1", "5cd9e13aa", "e7a20b4bb", 1)]), ["marlin force-pushed 5cd9e13 → e7a20b4"]);
  assert.deepEqual(sentencesOf([forcePush("f1", null, "e7a20b4bb", 1)]), ["marlin force-pushed to e7a20b4"]);
  assert.deepEqual(sentencesOf([forcePush("f1", null, null, 1)]), ["marlin force-pushed"]);
  assert.deepEqual(sentencesOf([forcePush("f1", "a", "b", 1), forcePush("f2", "b", "c", 2), forcePush("f3", "c", "d", 3)]), ["marlin force-pushed 3 times"]);
});

test("one person's labels list what they added, then what they removed; a label added and removed says both", () => {
  assert.deepEqual(sentencesOf([label("l1", "marlin", true, "enhancement", 1), label("l2", "marlin", false, "triage", 2), label("l3", "marlin", true, "wip", 3)]), ["marlin added enhancement and wip and removed triage"]);
  assert.deepEqual(sentencesOf([label("l1", "lumen-bot", true, "needs-triage", 1), label("l2", "lumen-bot", false, "needs-triage", 2)]), ["lumen-bot added and removed needs-triage"]);
  assert.deepEqual(sentencesOf([label("l1", "lumen-bot", true, "needs-triage", 1), label("l2", "marlin", false, "needs-triage", 2)]), ["lumen-bot added and marlin removed needs-triage"]);
});

test("review requests list their reviewers, and withdrawn ones say so", () => {
  assert.deepEqual(sentencesOf([request("q1", true, "jun-park"), request("q2", true, "okafor-t"), request("q3", true, "ivy-chen")]), ["marlin requested a review from jun-park, okafor-t and ivy-chen"]);
  assert.deepEqual(sentencesOf([request("q1", false, "ivy-chen")]), ["marlin removed the review request for ivy-chen"]);
});

test("a mention names where; more say how many", () => {
  assert.deepEqual(sentencesOf([mention("x1", 1)]), ["okafor-t mentioned this in #141 Table performance"]);
  assert.deepEqual(sentencesOf([mention("x1", 1), mention("x2", 2)]), ["okafor-t mentioned this 2 times"]);
});

test("events and the merge read as GitHub says them", () => {
  assert.deepEqual(
    sentencesOf([
      { kind: "renamed", id: "n1", actor: "marlin", createdAt: at(1), from: "Virtualize table rows", to: "Virtualize long lists" },
      { kind: "status", id: "s1", actor: "marlin", createdAt: at(2), status: "ready-for-review" },
      { kind: "merged", id: "mg", actor: "okafor-t", createdAt: at(3), base: "main" },
    ]),
    ["marlin changed the title to Virtualize long lists", "marlin marked this ready for review", "okafor-t merged into main"],
  );
});

test("a review line says its verdict and how many threads it resolved", () => {
  const review = (verdict: "approved" | "changes-requested", threadIds: string[]): TimelineItem => ({
    kind: "review",
    id: `r-${verdict}`,
    verdict,
    comment: { id: 1, url: "", author: { login: "jun-park", bot: false }, body: "", createdAt: at(1) },
    threadIds,
  });
  const resolved = THREADS.filter((thread) => thread.resolvedBy !== null);
  const lines = activityOf({ author: "marlin", createdAt: at(0), state: "OPEN" }, [review("approved", []), review("changes-requested", resolved.map((thread) => thread.id))], resolved);

  assert.deepEqual(
    lines.slice(1).map((line) => (line.kind === "review" ? textOf(wordsOf(line)) : line.kind)),
    ["jun-park approved", `jun-park requested changes · ${resolved.length} resolved threads`],
  );
});

test("a folded line opens to its items: commits by sha and headline, force-pushes by shas, each at its time", () => {
  const [commits] = linesOf([commit("c1", 1), commit("c2", 2)]).slice(1);
  const [pushes] = linesOf([forcePush("f1", "5cd9e13aa", "e7a20b4bb", 3), forcePush("f2", "e7a20b4bb", "1d93c6fcc", 4)]).slice(1);
  const itemsOf = (line: ActivityLine) => foldItemsOf(line)?.map((item) => [textOf(item.words), item.at]);

  assert.deepEqual(itemsOf(commits), [
    ["c1a1b2c Commit c1", at(1)],
    ["c2a1b2c Commit c2", at(2)],
  ]);
  assert.deepEqual(itemsOf(pushes), [
    ["5cd9e13 → e7a20b4", at(3)],
    ["e7a20b4 → 1d93c6f", at(4)],
  ]);
});

test("a line of one, labels and review requests open to nothing: their sentence says it all", () => {
  const lines = linesOf([commit("c1", 1), label("l1", "marlin", true, "wip", 2), label("l2", "marlin", true, "ci", 3), request("q1", true, "jun-park")]);

  assert.deepEqual(lines.map(foldItemsOf), [null, null, null, null]);
});

// withastro/astro#18616's threads, as recorded (github/fixtures/comments).
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../github/fixtures/comments/${name}.json`, import.meta.url), "utf8"));
const threadsOf = (name: string): ReviewThread[] => parseThreadsPage(fixture(name)).nodes.map((thread) => toThread(thread, thread.comments.nodes));
const THREADS = threadsOf("threads-astro-18616");

test("a review thread's row: its file name and line at the head, else where it was written, and its state", () => {
  // The first four are on lines and outdated; the last is on the whole file, so it has no line.
  const rows = THREADS.map((thread) => [threadLocationOf(thread), threadStateOf(thread)]);

  assert.deepEqual(rows, [
    ["index.ts:50", "resolved · outdated"],
    ["index.ts:36", "resolved · outdated"],
    ["index.ts:60", "resolved · outdated"],
    ["index.ts:70", "resolved · outdated"],
    ["true-parks-retire.md", ""],
  ]);
  // This repo's PR #71: a range open at the head, on its new line 13.
  const [range] = threadsOf("threads-71");
  assert.deepEqual([threadLocationOf(range), threadStateOf(range)], ["gh.ts:13", ""]);
});
