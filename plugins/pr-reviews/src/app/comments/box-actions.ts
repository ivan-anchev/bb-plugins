// What the comment box can send as: which of its GitHub actions the reader has, posting at once
// (Comment or Reply) or adding to their pending review, which GitHub publishes only when they
// submit it; the Send as segments those make, with Ask; the one the box sends with; and the words
// each mode puts in the box. Pure.
import type { ViewerReview } from "../../comments/review-schema.ts";
import type { Action } from "./box-problems.ts";

type Subject = "lines" | "reply" | "conversation";

/**
 * `publish`: Comment or Reply alone. `both`: a reviewer on lines can comment at once or start a
 * pending review (Review). `review`: with a pending review open, Review alone, into `reviewId`:
 * GitHub refuses a comment or reply on its own then, as GitHub.com offers only the review.
 */
export type GitHubActions = { kind: "publish" } | { kind: "both" } | { kind: "review"; reviewId: string };

/**
 * `viewer`: the reader's review, from the comments read; undefined until it is read, when the box
 * posts as it always has. `atHead`: the box's lines are on the PR's latest commit, where GitHub
 * puts a review comment.
 */
export function githubActionsOf(subject: Subject, viewer: ViewerReview | undefined, atHead: boolean): GitHubActions {
  if (subject === "conversation" || viewer === undefined) return { kind: "publish" };
  if (viewer.pendingReviewId !== null) return { kind: "review", reviewId: viewer.pendingReviewId };
  return subject === "lines" && !viewer.author && atHead ? { kind: "both" } : { kind: "publish" };
}

/** A Send as segment: what it sends as, and why it can't now (its tooltip), or null when it can. */
export type Segment = { mode: Action; reason: string | null };

/**
 * The box's segments, in order. Lines and threads: Ask, which needs the agent review's thread
 * (`hasThread`); Comment, which GitHub holds back while a review is pending; and Review, while
 * the reader has one or can start one, which takes lines only at the PR's head (`atHead`). The
 * conversation: Comment alone, since GitHub can't hold a conversation comment in a review and
 * the agent review is about the code.
 */
export function segmentsOf(subject: Subject, actions: GitHubActions, hasThread: boolean, atHead: boolean): Segment[] {
  const comment = can("comment");
  if (subject === "conversation") return [comment];
  const ask = hasThread ? can("ask") : cant("ask", "Start an agent review to ask about these lines.");
  switch (actions.kind) {
    case "publish":
      return [ask, comment];
    case "both":
      return [ask, comment, can("review")];
    case "review":
      return [
        ask,
        cant("comment", "GitHub holds new comments while your review is pending. Add this to the review instead."),
        atHead ? can("review") : cant("review", NOT_AT_HEAD),
      ];
    default:
      return actions satisfies never;
  }
}

const can = (mode: Action): Segment => ({ mode, reason: null });
const cant = (mode: Action, reason: string): Segment => ({ mode, reason });

/** Why Review can't take lines on an older commit. */
const NOT_AT_HEAD = "Your review takes comments on the PR's latest commit only. Refresh, then comment from the Changes tab.";

/**
 * The segment the box sends with: the one the reader last `picked`, in any box this session, if
 * it can send here; else the default, Review with a review pending and Comment otherwise; else the
 * first that can. With none that can, the first.
 */
export function selectedOf(segments: readonly Segment[], actions: GitHubActions, picked: Action | null): Segment {
  const fallback = actions.kind === "review" ? "review" : "comment";
  const usable = segments.filter((segment) => segment.reason === null);
  const of = (mode: Action | null) => (segment: Segment) => segment.mode === mode;
  return usable.find(of(picked)) ?? usable.find(of(fallback)) ?? usable.at(0) ?? segments[0];
}

/**
 * Where ← (`by` -1) or → (1) goes from the `from` segment: the next one round that can send,
 * skipping the disabled ones; null when none can.
 */
export function steppedFrom(segments: readonly Segment[], from: Action, by: 1 | -1): Action | null {
  const usable = segments.filter((segment) => segment.reason === null);
  if (usable.length === 0) return null;
  const at = usable.findIndex((segment) => segment.mode === from);
  return usable[(at + by + usable.length) % usable.length].mode;
}

/** What sending as `mode` does, as the send button and its tooltip name it. */
export function sendLabelOf(subject: Subject, mode: Action): string {
  switch (mode) {
    case "ask":
      return "Ask the agent";
    case "comment":
      // On GitHub a comment in a thread is a reply.
      return subject === "reply" ? "Reply" : "Comment";
    case "review":
      return "Add to review";
    default:
      return mode satisfies never;
  }
}


/** The empty box's placeholder: what the draft goes as. */
export function placeholderOf(subject: Subject, mode: Action): string {
  return subject === "conversation" ? "Comment on this pull request" : PLACEHOLDERS[subject][mode];
}

const PLACEHOLDERS = {
  lines: { ask: "Ask the agent about these lines", comment: "Leave a comment on GitHub", review: "Add a comment to your review" },
  reply: { ask: "Ask the agent about this thread", comment: "Reply on GitHub", review: "Add a reply to your review" },
} as const satisfies Record<Exclude<Subject, "conversation">, Record<Action, string>>;
