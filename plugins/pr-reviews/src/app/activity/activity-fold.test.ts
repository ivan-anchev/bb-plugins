import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TimelineItem } from "../../comments/timeline-schema.ts";
import { parseThreadsPage, toThread } from "../../github/pr-comments.ts";
import { isReview, parseTimelinePage, toTimeline } from "../../github/pr-timeline.ts";
import { activityOf, lastTimeOf, type ActivityBlock, type ActivityLine, type RunEntry } from "./activity-fold.ts";
import { rowsOf, type ActivityRow } from "./activity-rows.ts";
import { dayLabelOf, runSummaryOf, threadLocationOf, threadStateOf } from "./activity-words.ts";

// Days are the reader's local ones; these read in UTC.
process.env.TZ = "UTC";

// withastro/astro#18616 as recorded (github/fixtures/comments), parsed as gh.ts parses it.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../github/fixtures/comments/${name}.json`, import.meta.url), "utf8"));
const THREADS = parseThreadsPage(fixture("threads-astro-18616")).nodes.map((thread) => toThread(thread, thread.comments.nodes));
const NODES = parseTimelinePage(fixture("timeline-astro-18616")).nodes;
const TIMELINE = toTimeline(NODES, new Map(NODES.filter(isReview).map((review) => [review.id, review.comments.nodes.map((comment) => comment.databaseId)])), THREADS);

// Each block and line as a short word, so the whole fold reads at a glance.
const entryWord = (entry: RunEntry) => (entry.kind === "label-pair" ? `±${entry.added.label.name}` : entry.item.kind);
const lineWord = (line: ActivityLine) => {
  switch (line.kind) {
    case "run":
      return `run(${line.entries.map(entryWord).join(", ")})`;
    case "review":
      return `${line.review.comment.author.login} ${line.review.verdict} line`;
    case "merged":
      return "merged";
  }
};
const blockWord = (block: ActivityBlock) => {
  switch (block.kind) {
    case "comment":
      return `${block.item.comment.author.login} comment`;
    case "review":
      return `${block.review.comment.author.login} ${block.review.verdict} message (${block.threads.length} thread)`;
    case "lines":
      return block.lines.map(lineWord);
  }
};

test("astro#18616: by day, messages on the page, and the rest in blocks of runs and review lines", () => {
  assert.deepEqual(
    activityOf(TIMELINE, THREADS).map((day) => ({ date: day.date, blocks: day.blocks.map(blockWord) })),
    [
      {
        date: "2026-11-04",
        blocks: [
          ["run(commit)"],
          "changeset-bot comment",
          [
            "run(commit, ±pr: astro-review)",
            "astro-factory commented line",
            "run(commit, ±pr: astro-review)",
            "astro-factory commented line",
            "run(labeled, commit, ±pr: astro-review)",
            "astro-factory commented line",
            "run(commit, ±pr: astro-review)",
            "astro-factory commented line",
            "run(commit, commit, renamed)",
          ],
          "codspeed comment",
        ],
      },
      {
        date: "2026-11-05",
        blocks: [
          ["run(status)"],
          "ematipico commented message (1 thread)",
          "florian-lefebvre comment",
          "ematipico comment",
          ["ematipico approved line"],
          "matthewp comment",
          "matthewp comment",
          ["matthewp approved line"],
        ],
      },
      // The close the merge caused is the merge's.
      { date: "2026-11-06", blocks: ["florian-lefebvre comment", ["merged", "run(referenced)"]] },
    ],
  );
});

test("a run's line counts its changes in the order they first happened, a label pair as one", () => {
  const runs = activityOf(TIMELINE, THREADS)
    .flatMap((day) => day.blocks)
    .flatMap((block) => (block.kind === "lines" ? block.lines : []))
    .flatMap((line) => (line.kind === "run" && line.entries.length > 1 ? [runSummaryOf(line.entries)] : []));

  assert.deepEqual(runs, [
    "1 commit and 1 label change",
    "1 commit and 1 label change",
    "2 label changes and 1 commit",
    "1 commit and 1 label change",
    "2 commits and 1 title change",
  ]);
});

test("a run's time is its latest item's, a label pair's its removal", () => {
  const run = activityOf(TIMELINE, THREADS)[0].blocks.flatMap((block) => (block.kind === "lines" ? block.lines : []))[1];

  assert.equal(run.kind === "run" && lastTimeOf(run.entries), "2026-11-04T14:36:18Z");
});

// Small timelines, built as the parse builds them.
const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, "0")}:00Z`;
const label = (id: string, added: boolean, name: string, minute: number): TimelineItem => ({ kind: "labeled", id, actor: "bot", createdAt: at(minute), added, label: { name, color: "#ffffff" } });
const commit = (id: string, minute: number): TimelineItem => ({ kind: "commit", id, sha: id, headline: id, url: "", createdAt: at(minute) });
const entriesOf = (timeline: TimelineItem[]) => {
  const [block] = activityOf(timeline, [])[0].blocks;
  assert.equal(block.kind, "lines");
  return block.kind === "lines" && block.lines[0].kind === "run" ? block.lines[0].entries.map(entryWord) : null;
};

test("only a label added then removed pairs: a removal first, another label, or a second removal stay apart", () => {
  assert.deepEqual(entriesOf([label("a", false, "ci", 1), label("b", true, "ci", 2)]), ["labeled", "labeled"]);
  assert.deepEqual(entriesOf([label("a", true, "ci", 1), label("b", false, "docs", 2)]), ["labeled", "labeled"]);
  assert.deepEqual(entriesOf([label("a", true, "ci", 1), commit("c", 2), label("b", false, "ci", 3), label("d", false, "ci", 4)]), ["±ci", "commit", "labeled"]);
});

test("a run keeps its first item's key as it grows, so a line the reader opened stays open on a refresh", () => {
  const keyOf = (timeline: TimelineItem[]) => {
    const [block] = activityOf(timeline, [])[0].blocks;
    return block.kind === "lines" && block.lines[0].kind === "run" ? block.lines[0].key : null;
  };

  assert.equal(keyOf([commit("c1", 1), commit("c2", 2)]), "c1");
  assert.equal(keyOf([commit("c1", 1), commit("c2", 2), label("l", true, "ci", 3)]), "c1");
});

test("a review whose threads a refresh reopens reads as a message again", () => {
  const review = TIMELINE.find((item) => item.kind === "review")!;
  const reopened = THREADS.map((thread) => ({ ...thread, resolvedBy: null }));
  const blocksOf = (threads: typeof THREADS) => activityOf([review], threads)[0].blocks.map(blockWord);

  assert.deepEqual(blocksOf(THREADS), [["astro-factory commented line"]]);
  assert.deepEqual(blocksOf(reopened), ["astro-factory commented message (1 thread)"]);
});

test("a review keeps its row in every form, as a refresh resolves or reopens its threads and as the reader opens it", () => {
  const review = TIMELINE.find((item) => item.kind === "review")!;
  const reopened = THREADS.map((thread) => ({ ...thread, resolvedBy: null }));
  const rowOf = (threads: typeof THREADS, opened: ReadonlySet<string> = new Set()) =>
    rowsOf(activityOf([review], threads)[0].blocks, opened).map((row) => [row.key, row.kind === "review" ? row.form : row.kind]);

  assert.deepEqual(rowOf(THREADS), [[review.id, "line"]]);
  assert.deepEqual(rowOf(reopened), [[review.id, "message"]]);
  assert.deepEqual(rowOf(THREADS, new Set([review.id])), [[review.id, "opened"]]);
  assert.deepEqual(rowOf(reopened, new Set([review.id])), [[review.id, "message"]], "a review on the page has no line to open");
});

test("a tinted block's rows draw its top and bottom, and a review the reader opens splits it", () => {
  const [day] = activityOf(TIMELINE, THREADS);
  const tintWord = (row: ActivityRow) => (row.tint === null ? "page" : `${row.tint.first ? "top" : ""}${row.tint.last ? "bottom" : ""}` || "middle");
  const tintsWith = (opened: ReadonlySet<string>) => rowsOf(day.blocks, opened).map(tintWord);
  const firstReviewLine = rowsOf(day.blocks, new Set()).find((row) => row.kind === "review")!;

  assert.deepEqual(tintsWith(new Set()), ["topbottom", "page", "top", "middle", "middle", "middle", "middle", "middle", "middle", "middle", "bottom", "page"]);
  assert.deepEqual(tintsWith(new Set([firstReviewLine.key])), ["topbottom", "page", "topbottom", "page", "top", "middle", "middle", "middle", "middle", "middle", "bottom", "page"]);
});

test("a day reads with its weekday, and its year only when it is not this year's", () => {
  const now = new Date(2026, 10, 10);

  assert.equal(dayLabelOf("2026-11-04", now), "Wednesday, Nov 4");
  assert.equal(dayLabelOf("2025-12-31", now), "Wednesday, Dec 31, 2025");
});

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
  const [range] = parseThreadsPage(fixture("threads-71")).nodes.map((thread) => toThread(thread, thread.comments.nodes));
  assert.deepEqual([threadLocationOf(range), threadStateOf(range)], ["gh.ts:13", ""]);
});
