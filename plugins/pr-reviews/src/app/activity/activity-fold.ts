// How the Summary tab's activity reads, from the timeline and threads as last read: by day, each
// day's messages on the page and its other items as lines in tinted blocks. A run of commits and
// events between messages is one line, a label added then removed in it one change. A review
// without a body or open threads is one line too. Which lines the reader opened is theirs, kept
// apart (activity-timeline.tsx). Pure.
import type { ReviewThread } from "../../comments/thread-schema.ts";
import { timeOf, type TimelineItem } from "../../comments/timeline-schema.ts";

type ItemOf<Kind extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: Kind }>;
export type CommentItem = ItemOf<"comment">;
type ReviewItem = ItemOf<"review">;
export type MergedItem = ItemOf<"merged">;
type LabelItem = ItemOf<"labeled">;

/** A commit or an event that runs fold: anything but a message or the merge. */
export type RunItem = Exclude<TimelineItem, CommentItem | ReviewItem | MergedItem>;

/** One change of a run: an item, or a label one event added and a later one removed. */
export type RunEntry = { kind: "item"; item: RunItem } | { kind: "label-pair"; added: LabelItem; removed: LabelItem };

/** A review with the threads it wrote in, as last read. */
export type ReviewWithThreads = { review: ReviewItem; threads: ReviewThread[] };

/**
 * A line of a tinted block. `run`: commits and events between messages, keyed by its first item,
 * one line when it holds more than one entry. `review`: a review with only a verdict, or whose
 * threads are all resolved. `merged`: the merge.
 */
export type ActivityLine = { kind: "run"; key: string; entries: RunEntry[] } | ({ kind: "review" } & ReviewWithThreads) | { kind: "merged"; item: MergedItem };

/** A message on the page, a review with a body or an open thread, or a block of lines. */
export type ActivityBlock = { kind: "comment"; item: CommentItem } | ({ kind: "review" } & ReviewWithThreads) | { kind: "lines"; lines: ActivityLine[] };

/** `date`: the local calendar day, YYYY-MM-DD. */
export type ActivityDay = { date: string; blocks: ActivityBlock[] };

export function activityOf(timeline: readonly TimelineItem[], threads: readonly ReviewThread[]): ActivityDay[] {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  return daysOf(withoutMergeClose(timeline)).map(({ date, items }) => ({ date, blocks: blocksOf(items, threadsById) }));
}

/** A review that reads as one line: its threads all resolved, or only a verdict, with no body and no thread. */
const isReviewLine = ({ review, threads }: ReviewWithThreads) => !threads.some((thread) => thread.resolvedBy === null) && (review.comment.body.trim() === "" || threads.length > 0);

/** The time a run line shows: its latest item's. */
export function lastTimeOf(entries: readonly RunEntry[]): string {
  const times = entries.map((entry) => (entry.kind === "item" ? timeOf(entry.item) : entry.removed.createdAt));
  return times.reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
}

// GitHub closes a PR as it merges it; the merge says both.
function withoutMergeClose(timeline: readonly TimelineItem[]): TimelineItem[] {
  return timeline.filter((item, index) => !(item.kind === "status" && item.status === "closed" && timeline[index - 1]?.kind === "merged"));
}

function daysOf(timeline: TimelineItem[]): { date: string; items: TimelineItem[] }[] {
  const days: { date: string; items: TimelineItem[] }[] = [];
  for (const item of timeline) {
    const date = localDateOf(timeOf(item));
    const today = days.at(-1);
    if (today?.date === date) today.items.push(item);
    else days.push({ date, items: [item] });
  }
  return days;
}

const localDateOf = (iso: string) => {
  const at = new Date(iso);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

// While the blocks are built, a run collects its items; its entries come once it is complete.
type DraftLine = Exclude<ActivityLine, { kind: "run" }> | { kind: "run"; key: string; items: RunItem[] };
type DraftBlock = Exclude<ActivityBlock, { kind: "lines" }> | { kind: "lines"; lines: DraftLine[] };

// Each item is a message, a line of its own, or joins the run the last line opened.
function blocksOf(items: TimelineItem[], threadsById: ReadonlyMap<string, ReviewThread>): ActivityBlock[] {
  const blocks: DraftBlock[] = [];
  const addLine = (line: DraftLine) => {
    const last = blocks.at(-1);
    if (last?.kind === "lines") last.lines.push(line);
    else blocks.push({ kind: "lines", lines: [line] });
  };
  for (const item of items) {
    switch (item.kind) {
      case "comment":
        blocks.push({ kind: "comment", item });
        break;
      case "review": {
        const review = { review: item, threads: item.threadIds.flatMap((id) => threadsById.get(id) ?? []) };
        if (isReviewLine(review)) addLine({ kind: "review", ...review });
        else blocks.push({ kind: "review", ...review });
        break;
      }
      case "merged":
        addLine({ kind: "merged", item });
        break;
      case "commit":
      case "labeled":
      case "renamed":
      case "review-requested":
      case "review-dismissed":
      case "assigned":
      case "milestoned":
      case "force-pushed":
      case "base-changed":
      case "referenced":
      case "status": {
        const run = openRun(blocks);
        if (run === null) addLine({ kind: "run", key: item.id, items: [item] });
        else run.items.push(item);
        break;
      }
      default:
        item satisfies never;
    }
  }
  return blocks.map((block) => (block.kind === "lines" ? { kind: "lines", lines: block.lines.map(completed) } : block));
}

// The run the last line is, which the next commit or event joins.
function openRun(blocks: DraftBlock[]): Extract<DraftLine, { kind: "run" }> | null {
  const last = blocks.at(-1);
  const line = last?.kind === "lines" ? last.lines.at(-1) : undefined;
  return line?.kind === "run" ? line : null;
}

const completed = (line: DraftLine): ActivityLine => (line.kind === "run" ? { kind: "run", key: line.key, entries: entriesOf(line.items) } : line);

// A label added and later removed in the same run, as bots and CI do, is one change: at the add.
function entriesOf(items: RunItem[]): RunEntry[] {
  const paired = new Set<RunItem>();
  return items.flatMap((item, index): RunEntry[] => {
    if (paired.has(item)) return [];
    if (item.kind !== "labeled" || !item.added) return [{ kind: "item", item }];
    const removed = items.slice(index + 1).find((later): later is LabelItem => later.kind === "labeled" && !later.added && later.label.name === item.label.name && !paired.has(later));
    if (removed === undefined) return [{ kind: "item", item }];
    paired.add(removed);
    return [{ kind: "label-pair", added: item, removed }];
  });
}
