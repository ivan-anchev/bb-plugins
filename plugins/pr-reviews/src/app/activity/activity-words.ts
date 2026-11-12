// The words of the activity: each line's sentence, the items a folded line opens to, and its review
// threads' rows. A sentence is words, some of which the line draws apart (activity-line.tsx). Pure.
import type { ReviewThread } from "../../comments/thread-schema.ts";
import type { ReviewVerdict } from "../../comments/timeline-schema.ts";
import type { Label } from "../../github/label.ts";
import type { ActivityLine, ForcePushItem, LabelItem, LoneItem, MentionItem } from "./activity-fold.ts";

/**
 * A piece of a sentence: plain words, or `sha` (a commit, a link when it has a page), `code` (a
 * branch), `label`, `title` (a PR's or milestone's) or `link` (another issue or PR).
 */
export type Word =
  | string
  | { kind: "sha"; sha: string; url: string | null }
  | { kind: "code"; text: string }
  | { kind: "label"; label: Label }
  | { kind: "title"; text: string }
  | { kind: "link"; text: string; url: string };

/** One item a folded line opens to: its words and its time. */
export type FoldItem = { key: string; words: Word[]; at: string };

/** "marlin force-pushed 7 times": a line's sentence. A fold of commits names no one, since a commit carries no author. */
export function wordsOf(line: ActivityLine): Word[] {
  switch (line.kind) {
    case "opened":
      return [line.draft ? "Opened as a draft by " : "Opened by ", line.author];
    case "commits": {
      const [commit] = line.items;
      return line.items.length === 1 ? ["Pushed ", { kind: "sha", sha: commit.sha, url: commit.url }, ` ${commit.headline}`] : [`Pushed ${line.items.length} commits`];
    }
    case "force-pushes": {
      const [push] = line.items;
      return line.items.length === 1 ? [push.actor, " force-pushed", ...withSpace(shasOf(push))] : [`${push.actor} force-pushed ${line.items.length} times`];
    }
    case "labels":
      return [line.items[0].actor, " ", ...labelChangesOf(line.items)];
    case "label-pair": {
      const { added, removed } = line;
      const label: Word = { kind: "label", label: added.label };
      return added.actor === removed.actor ? [added.actor, " added and removed ", label] : [added.actor, " added and ", removed.actor, " removed ", label];
    }
    case "review-requests": {
      const [request] = line.items;
      const reviewers = listOf(line.items.map((item) => [item.reviewer]));
      return [request.actor, request.requested ? " requested a review from " : " removed the review request for ", ...reviewers];
    }
    case "mentions": {
      const [mention] = line.items;
      return line.items.length === 1 ? [mention.actor, " mentioned this in ", mentionLinkOf(mention)] : [`${mention.actor} mentioned this ${line.items.length} times`];
    }
    case "event":
      return eventWordsOf(line.item);
    case "review": {
      const { review, threads } = line;
      const resolved = threads.length === 0 ? "" : ` · ${countOf(threads.length, "resolved thread")}`;
      return [review.comment.author.login, ` ${VERDICT_WORDS[review.verdict]}${resolved}`];
    }
    case "merged":
      return [line.item.actor, " merged into ", { kind: "code", text: line.item.base }];
    default:
      return line satisfies never;
  }
}

/** The items a folded line opens to, oldest first: more than one commit, force-push or mention. Null for a line with none. */
export function foldItemsOf(line: ActivityLine): FoldItem[] | null {
  switch (line.kind) {
    case "commits":
      return line.items.length === 1 ? null : line.items.map((commit) => ({ key: commit.id, words: [{ kind: "sha", sha: commit.sha, url: commit.url }, ` ${commit.headline}`], at: commit.createdAt }));
    case "force-pushes":
      return line.items.length === 1 ? null : line.items.map((push) => ({ key: push.id, words: shasOf(push), at: push.createdAt }));
    case "mentions":
      return line.items.length === 1 ? null : line.items.map((mention) => ({ key: mention.id, words: [mentionLinkOf(mention)], at: mention.createdAt }));
    case "opened":
    case "labels":
    case "label-pair":
    case "review-requests":
    case "event":
    case "review":
    case "merged":
      return null;
    default:
      return line satisfies never;
  }
}

/** What a review's verdict says after its author's name. */
export const VERDICT_WORDS = {
  approved: "approved",
  "changes-requested": "requested changes",
  commented: "reviewed",
  dismissed: "reviewed",
} as const satisfies Record<ReviewVerdict, string>;

const countOf = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

const withSpace = (words: Word[]): Word[] => (words.length === 0 ? [] : [" ", ...words]);

// "a1b2c3d → e4f5a6b", or the side GitHub still has.
function shasOf({ before, after }: ForcePushItem): Word[] {
  const sha = (oid: string): Word => ({ kind: "sha", sha: oid, url: null });
  if (before !== null && after !== null) return [sha(before), " → ", sha(after)];
  if (before !== null) return ["from ", sha(before)];
  if (after !== null) return ["to ", sha(after)];
  return [];
}

// "added a and b and removed c", in that order whatever order they came in.
function labelChangesOf(items: LabelItem[]): Word[] {
  const labels = (added: boolean) => listOf(items.filter((item) => item.added === added).map((item): Word[] => [{ kind: "label", label: item.label }]));
  const added = labels(true);
  const removed = labels(false);
  if (removed.length === 0) return ["added ", ...added];
  if (added.length === 0) return ["removed ", ...removed];
  return ["added ", ...added, " and removed ", ...removed];
}

const mentionLinkOf = (mention: MentionItem): Word => ({ kind: "link", text: `${mention.ref} ${mention.title}`, url: mention.url });

function eventWordsOf(item: LoneItem): Word[] {
  switch (item.kind) {
    case "renamed":
      return [item.actor, " changed the title to ", { kind: "title", text: item.to }];
    case "review-dismissed":
      return [item.actor, ` dismissed ${item.reviewer}’s review`];
    case "assigned":
      return [item.actor, item.assigned ? " assigned " : " unassigned ", item.assignee];
    case "milestoned":
      return [item.actor, item.added ? " added this to the " : " removed this from the ", { kind: "title", text: item.title }, " milestone"];
    case "base-changed":
      return [item.actor, " changed the base branch from ", { kind: "code", text: item.from }, " to ", { kind: "code", text: item.to }];
    case "status":
      return [item.actor, ` ${STATUS_WORDS[item.status]}`];
    default:
      return item satisfies never;
  }
}

const STATUS_WORDS = {
  "ready-for-review": "marked this ready for review",
  draft: "marked this as a draft",
  closed: "closed this",
  reopened: "reopened this",
  "branch-deleted": "deleted the branch",
  "branch-restored": "restored the branch",
  "auto-merge-enabled": "enabled auto-merge",
  "auto-merge-disabled": "disabled auto-merge",
} as const satisfies Record<Extract<LoneItem, { kind: "status" }>["status"], string>;

/** "a", "a and b", "a, b and c". */
function listOf(phrases: readonly Word[][]): Word[] {
  return phrases.flatMap((phrase, index) => [...(index === 0 ? [] : [index === phrases.length - 1 ? " and " : ", "]), ...phrase]);
}

/** "index.ts:50": a review thread's file name and last line, at the head unless it is outdated. A thread on a whole file has no line. */
export function threadLocationOf(thread: ReviewThread): string {
  const name = thread.path.slice(thread.path.lastIndexOf("/") + 1);
  const [anchor] = thread.subject.kind === "lines" ? thread.subject.anchors : [];
  return anchor === undefined ? name : `${name}:${anchor.end.line}`;
}

/** "resolved · outdated": what a thread's digest row says of it, "" for an open thread on the current lines. */
export const threadStateOf = (thread: ReviewThread): string => [thread.resolvedBy === null ? null : "resolved", thread.outdated ? "outdated" : null].filter((word) => word !== null).join(" · ");
