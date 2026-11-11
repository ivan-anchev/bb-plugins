// The words of the activity: its folded lines, its day dividers and its review threads' rows. Pure.
import type { ReviewThread } from "../../comments/thread-schema.ts";
import type { RunEntry } from "./activity-fold.ts";

type Noun = { one: string; many: string };

const noun = (one: string, many = `${one}s`): Noun => ({ one, many });

const LABEL = noun("label change");
const STATE = noun("state change");

// What a run counts each entry as.
function nounOf(entry: RunEntry): Noun {
  if (entry.kind === "label-pair") return LABEL;
  const { item } = entry;
  switch (item.kind) {
    case "commit":
      return noun("commit");
    case "labeled":
      return LABEL;
    case "renamed":
      return noun("title change");
    case "review-requested":
      return noun("review request");
    case "review-dismissed":
      return noun("dismissed review");
    case "assigned":
      return noun("assignee change");
    case "milestoned":
      return noun("milestone change");
    case "force-pushed":
      return noun("force-push", "force-pushes");
    case "base-changed":
      return noun("base branch change");
    case "referenced":
      return noun("mention");
    case "status":
      switch (item.status) {
        case "ready-for-review":
        case "draft":
        case "closed":
        case "reopened":
          return STATE;
        case "branch-deleted":
        case "branch-restored":
          return noun("branch change");
        case "auto-merge-enabled":
        case "auto-merge-disabled":
          return noun("auto-merge change");
        default:
          return item.status satisfies never;
      }
    default:
      return item satisfies never;
  }
}

/** "1 commit and 2 label changes": a folded run's counts, in the order each first happened. */
export function runSummaryOf(entries: readonly RunEntry[]): string {
  const counts = new Map<string, { counted: Noun; count: number }>();
  for (const entry of entries) {
    const counted = nounOf(entry);
    counts.set(counted.one, { counted, count: (counts.get(counted.one)?.count ?? 0) + 1 });
  }
  return listOf([...counts.values()].map(({ counted, count }) => `${count} ${count === 1 ? counted.one : counted.many}`));
}

/** "a", "a and b", "a, b and c". */
function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** "Wednesday, Nov 4", with the year when it is not this year's. `date` is YYYY-MM-DD. */
export function dayLabelOf(date: string, now: Date): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(year, month - 1, day);
  return at.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: year === now.getFullYear() ? undefined : "numeric" });
}

/** "index.ts:50": a review thread's file name and last line, at the head unless it is outdated. A thread on a whole file has no line. */
export function threadLocationOf(thread: ReviewThread): string {
  const name = thread.path.slice(thread.path.lastIndexOf("/") + 1);
  const [anchor] = thread.subject.kind === "lines" ? thread.subject.anchors : [];
  return anchor === undefined ? name : `${name}:${anchor.end.line}`;
}

/** "resolved · outdated": what a thread's digest row says of it, "" for an open thread on the current lines. */
export const threadStateOf = (thread: ReviewThread): string => [thread.resolvedBy === null ? null : "resolved", thread.outdated ? "outdated" : null].filter((word) => word !== null).join(" · ");
