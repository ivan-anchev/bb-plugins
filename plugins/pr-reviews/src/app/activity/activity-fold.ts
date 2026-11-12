// How the Summary tab's activity reads, from the PR, its timeline and its threads as last read: the
// line it opened with, then its messages on the page and everything else as one line each. Between
// messages, consecutive changes of one kind fold to one line: every commit, or one person's
// force-pushes, labels, review requests and mentions. A label added then removed in the same run
// is one line of its own. A review whose threads are all resolved, or that is only a verdict, is a
// line too. Which lines the reader opened is theirs, kept apart (activity-timeline.tsx). Pure.
import type { ReviewThread } from "../../comments/thread-schema.ts";
import { timeOf, type TimelineItem } from "../../comments/timeline-schema.ts";
import type { PrDetail } from "../../contract.ts";

type ItemOf<Kind extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: Kind }>;
export type CommentItem = ItemOf<"comment">;
type ReviewItem = ItemOf<"review">;
export type MergedItem = ItemOf<"merged">;
export type CommitItem = ItemOf<"commit">;
export type ForcePushItem = ItemOf<"force-pushed">;
export type LabelItem = ItemOf<"labeled">;
export type ReviewRequestItem = ItemOf<"review-requested">;
export type MentionItem = ItemOf<"referenced">;

/** A commit or an event between messages: anything but a message or the merge. */
type RunItem = Exclude<TimelineItem, CommentItem | ReviewItem | MergedItem>;

/** An event that is always a line of its own. */
export type LoneItem = Exclude<RunItem, CommitItem | ForcePushItem | LabelItem | ReviewRequestItem | MentionItem>;

/** A review with the threads it wrote in, as last read. */
export type ReviewWithThreads = { review: ReviewItem; threads: ReviewThread[] };

/**
 * One line, with a glyph in the gutter. Each fold holds one or more items, oldest first, and one
 * person's when it names one: `force-pushes`, `labels`, `mentions`, and `review-requests` all
 * requesting or all withdrawing. `opened`: the PR's first line, `draft` only when the timeline
 * shows it opened as one. `review`: one whose threads are all resolved, or with no body and no thread.
 */
export type ActivityLine =
  | { kind: "opened"; author: string; createdAt: string; draft: boolean }
  | { kind: "commits"; items: CommitItem[] }
  | { kind: "force-pushes"; items: ForcePushItem[] }
  | { kind: "labels"; items: LabelItem[] }
  | { kind: "label-pair"; added: LabelItem; removed: LabelItem }
  | { kind: "review-requests"; items: ReviewRequestItem[] }
  | { kind: "mentions"; items: MentionItem[] }
  | { kind: "event"; item: LoneItem }
  | ({ kind: "review" } & ReviewWithThreads)
  | { kind: "merged"; item: MergedItem };

/** A message on the page: a conversation comment, or a review with an open thread, or a body and no thread. */
export type ActivityMessage = { kind: "comment"; item: CommentItem } | ({ kind: "review-message" } & ReviewWithThreads);

export type ActivityPart = ActivityLine | ActivityMessage;

/** The PR's activity, oldest first, its opened line first. */
export function activityOf(pr: Pick<PrDetail, "author" | "createdAt" | "state">, timeline: readonly TimelineItem[], threads: readonly ReviewThread[]): ActivityPart[] {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const opened: ActivityLine = { kind: "opened", author: pr.author, createdAt: pr.createdAt, draft: openedAsDraft(pr.state, timeline) };
  return [opened, ...partsOf(withoutMergeClose(timeline), threadsById)];
}

/** A part's key, its first item's, so a fold keeps it as it grows and a review keeps it in either form. */
export function keyOf(part: ActivityPart): string {
  switch (part.kind) {
    case "opened":
      return "opened";
    case "commits":
    case "force-pushes":
    case "labels":
    case "review-requests":
    case "mentions":
      return part.items[0].id;
    case "label-pair":
      return part.added.id;
    case "event":
    case "merged":
    case "comment":
      return part.item.id;
    case "review":
    case "review-message":
      return part.review.id;
    default:
      return part satisfies never;
  }
}

/** The time a line shows: its latest item's, a label pair's its removal. */
export function timeOfLine(line: ActivityLine): string {
  switch (line.kind) {
    case "opened":
      return line.createdAt;
    case "commits":
    case "force-pushes":
    case "labels":
    case "review-requests":
    case "mentions":
      return line.items.map(timeOf).reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
    case "label-pair":
      return line.removed.createdAt;
    case "event":
    case "merged":
      return line.item.createdAt;
    case "review":
      return line.review.comment.createdAt;
    default:
      return line satisfies never;
  }
}

export const isMessage = (part: ActivityPart): part is ActivityMessage => part.kind === "comment" || part.kind === "review-message";

/** Where the connector between glyphs runs past each part: to the line above, to the line below. A message has none and breaks it. */
export function connectorsOf(parts: readonly ActivityPart[]): ({ up: boolean; down: boolean } | null)[] {
  const isLine = (index: number) => index >= 0 && index < parts.length && !isMessage(parts[index]);
  return parts.map((_part, index) => (isLine(index) ? { up: isLine(index - 1), down: isLine(index + 1) } : null));
}

// GitHub records no "opened" event. A PR first marked ready opened as a draft, one first marked a
// draft did not, and one never marked either way is still what it opened as. A closed or merged
// PR never marked either way may have opened as a draft: its line says only that it opened.
function openedAsDraft(state: PrDetail["state"], timeline: readonly TimelineItem[]): boolean {
  const first = timeline.find((item) => item.kind === "status" && (item.status === "ready-for-review" || item.status === "draft"));
  if (first?.kind === "status") return first.status === "ready-for-review";
  return state === "DRAFT";
}

// GitHub closes a PR as it merges it; the merge says both.
function withoutMergeClose(timeline: readonly TimelineItem[]): TimelineItem[] {
  return timeline.filter((item, index) => !(item.kind === "status" && item.status === "closed" && timeline[index - 1]?.kind === "merged"));
}

// Each item is a message or a line of its own, or joins the run of changes since the last one.
function partsOf(timeline: TimelineItem[], threadsById: ReadonlyMap<string, ReviewThread>): ActivityPart[] {
  const parts: ActivityPart[] = [];
  let run: RunItem[] = [];
  const add = (part: ActivityPart) => {
    parts.push(...linesOf(run), part);
    run = [];
  };
  for (const item of timeline) {
    switch (item.kind) {
      case "comment":
        add({ kind: "comment", item });
        break;
      case "review": {
        const review = { review: item, threads: item.threadIds.flatMap((id) => threadsById.get(id) ?? []) };
        add(isReviewLine(review) ? { kind: "review", ...review } : { kind: "review-message", ...review });
        break;
      }
      case "merged":
        add({ kind: "merged", item });
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
      case "status":
        run.push(item);
        break;
      default:
        item satisfies never;
    }
  }
  return [...parts, ...linesOf(run)];
}

const isReviewLine = ({ review, threads }: ReviewWithThreads) => threads.every((thread) => thread.resolvedBy !== null) && (review.comment.body.trim() === "" || threads.length > 0);

/** A run's change: an item, or a label one event added and a later one removed. */
type RunEntry = { kind: "item"; item: RunItem } | { kind: "label-pair"; added: LabelItem; removed: LabelItem };

// Consecutive entries that share a fold key fold to one line.
function linesOf(run: RunItem[]): ActivityLine[] {
  const folds: RunEntry[][] = [];
  for (const entry of entriesOf(run)) {
    const key = foldKeyOf(entry);
    const last = folds.at(-1);
    if (key !== null && last !== undefined && foldKeyOf(last[0]) === key) last.push(entry);
    else folds.push([entry]);
  }
  return folds.map(lineOf);
}

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

// What an entry folds with; null for an entry that is always a line of its own.
function foldKeyOf(entry: RunEntry): string | null {
  if (entry.kind === "label-pair") return null;
  const { item } = entry;
  switch (item.kind) {
    case "commit":
      return "commit";
    case "force-pushed":
    case "labeled":
    case "referenced":
      return `${item.kind} ${item.actor}`;
    case "review-requested":
      return `${item.kind} ${item.actor} ${item.requested}`;
    case "renamed":
    case "review-dismissed":
    case "assigned":
    case "milestoned":
    case "base-changed":
    case "status":
      return null;
    default:
      return item satisfies never;
  }
}

// A fold's entries all share its first one's key, so they are all of its kind.
function lineOf([first, ...rest]: RunEntry[]): ActivityLine {
  if (first.kind === "label-pair") return first;
  const items = [first.item, ...rest.flatMap((entry) => (entry.kind === "item" ? [entry.item] : []))];
  switch (first.item.kind) {
    case "commit":
      return { kind: "commits", items: items.filter(isKind("commit")) };
    case "force-pushed":
      return { kind: "force-pushes", items: items.filter(isKind("force-pushed")) };
    case "labeled":
      return { kind: "labels", items: items.filter(isKind("labeled")) };
    case "review-requested":
      return { kind: "review-requests", items: items.filter(isKind("review-requested")) };
    case "referenced":
      return { kind: "mentions", items: items.filter(isKind("referenced")) };
    default:
      return { kind: "event", item: first.item };
  }
}

const isKind =
  <Kind extends RunItem["kind"]>(kind: Kind) =>
  (item: RunItem): item is ItemOf<Kind> =>
    item.kind === kind;
