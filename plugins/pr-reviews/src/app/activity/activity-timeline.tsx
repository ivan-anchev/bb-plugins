// The Summary tab's activity, oldest first, as the fold reads it (activity-fold.ts): messages on the
// page, and every other part a line (activity-line.tsx) whose glyph a thin connector joins to the
// lines next to it. The connector stops at each message, never running behind one. A review line
// with threads opens to its body, if it has one, and its threads as rows, each opening the Changes
// tab at its thread. Which lines are open is the reader's one piece of state; everything else
// comes from the current read (REVIEW.md).
import { useMemo, useState, type ReactNode, type Ref } from "react";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import type { ReviewVerdict } from "../../comments/timeline-schema.ts";
import { firstLineOf, GitHubCommentView } from "../comments/github-comment.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import { Prose } from "../ui/prose.tsx";
import { connectorsOf, keyOf, type ActivityPart, type ReviewWithThreads } from "./activity-fold.ts";
import { FoldItems, Line } from "./activity-line.tsx";
import { foldItemsOf, threadLocationOf, threadStateOf, VERDICT_WORDS } from "./activity-words.ts";

type TimelineProps = {
  parts: ActivityPart[];
  prAuthor: string;
  /** The paths the PR's diff changes: a thread on any other file has no Changes tab to open. */
  changedPaths: ReadonlySet<string>;
  /** Quote on a message: its text as a quote for the composer. */
  onQuote(quote: string): void;
  /** A thread's row: show it in the Changes tab. */
  onShowThread(thread: ReviewThread): void;
};

/** What a part needs besides its own data: who wrote the PR, the diff's paths, what is open, and the actions. */
type Context = Omit<TimelineProps, "parts"> & { opened: ReadonlySet<string>; onToggle(key: string): void };

export function ActivityTimeline({ parts, ...actions }: TimelineProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const onToggle = (key: string) => setOpened((current) => toggled(current, key));
  const context = { ...actions, opened, onToggle };
  const connectors = connectorsOf(parts);
  return (
    <ol className="mt-2 grid grid-cols-[minmax(0,1fr)]">
      {parts.map((part, index) => {
        const connector = connectors[index];
        return (
          <li key={keyOf(part)} className="relative grid grid-cols-[minmax(0,1fr)]">
            {connector?.up && <span aria-hidden className={`top-0 h-[9px] ${CONNECTOR}`} />}
            {connector?.down && <span aria-hidden className={`top-[27px] bottom-0 ${CONNECTOR}`} />}
            <Part part={part} context={context} />
          </li>
        );
      })}
    </ol>
  );
}

// Down the gutter's middle, clear of the 14px glyph centred 18px down a line.
const CONNECTOR = "absolute left-3 w-px -translate-x-1/2 bg-subtle-foreground/20";

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

function Part({ part, context }: { part: ActivityPart; context: Context }) {
  switch (part.kind) {
    case "comment":
      return <Message comment={part.item.comment} verb={null} context={context} />;
    case "review":
    case "review-message":
      return <ReviewRow review={part} context={context} />;
    case "opened":
    case "commits":
    case "force-pushes":
    case "labels":
    case "label-pair":
    case "review-requests":
    case "mentions":
    case "event":
    case "merged": {
      const items = foldItemsOf(part);
      const key = keyOf(part);
      return <Line line={part} fold={items === null ? null : <FoldItems items={items} />} open={context.opened.has(key)} onToggle={() => context.onToggle(key)} />;
    }
    default:
      return part satisfies never;
  }
}

/** A message on the page: a conversation comment, or a review with its threads under it. */
function Message({ ref, comment, verb, context, children }: { ref?: Ref<HTMLElement>; comment: GitHubComment; verb: ReactNode; context: Context; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <GitHubCommentView
        ref={ref}
        comment={comment}
        density="page"
        byPrAuthor={comment.author.login === context.prAuthor}
        verb={verb}
        onQuote={() => context.onQuote(quoteReplyText(comment.body))}
      >
        {children}
      </GitHubCommentView>
    </div>
  );
}

// A review as a message or a line. Its row stays as a refresh moves it from one to the other, as
// when a thread is resolved or reopened, and hands focus from the form that leaves, wherever in it
// focus is (a line's fold too), to the one that comes: to the line, or to the message, which holds
// focus but is no tab stop. Each form is keyed, so a change of form always replaces it whole.
function ReviewRow({ review, context }: { review: Extract<ActivityPart, { kind: "review" | "review-message" }>; context: Context }) {
  const focus = useFocusHandOff();
  const key = review.review.id;
  if (review.kind === "review") {
    const fold = review.threads.length === 0 ? null : <ReviewFold review={review} context={context} />;
    return (
      <div key={review.kind} ref={focus.from} className="grid grid-cols-[minmax(0,1fr)]">
        <Line ref={focus.to} line={review} fold={fold} open={context.opened.has(key)} onToggle={() => context.onToggle(key)} />
      </div>
    );
  }
  return (
    <div key={review.kind} ref={focus.from}>
      <ReviewMessage ref={focus.to} review={review} context={context} />
    </div>
  );
}

function ReviewMessage({ ref, review: { review, threads }, context }: { ref?: Ref<HTMLElement>; review: ReviewWithThreads; context: Context }) {
  return (
    <Message ref={ref} comment={review.comment} verb={<Verdict verdict={review.verdict} />} context={context}>
      {threads.length > 0 && <Digest threads={threads} context={context} />}
    </Message>
  );
}

// A review's threads: one row each, its file and line, its first line, and whether it is resolved
// or outdated.
function Digest({ threads, context }: { threads: ReviewThread[]; context: Context }) {
  return (
    <ul aria-label="Review threads" className="col-start-2 mt-2 -ml-2 grid grid-cols-[minmax(0,1fr)] rounded-lg bg-(--pr-reviews-thread-tint) p-0.5">
      {threads.map((thread) => (
        <li key={thread.id} className="grid">
          <DigestRow thread={thread} context={context} />
        </li>
      ))}
    </ul>
  );
}

// A review line, opened under its words: its body, if it has one, then its threads.
function ReviewFold({ review: { review, threads }, context }: { review: ReviewWithThreads; context: Context }) {
  const hasBody = review.comment.body.trim() !== "";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] pb-1.5 pl-9">
      {hasBody && <Prose text={review.comment.body} className="pb-1 text-sm leading-[22px]" />}
      <ul aria-label="Review threads" className="-ml-2 grid grid-cols-[minmax(0,1fr)]">
        {threads.map((thread) => (
          <li key={thread.id} className="grid">
            <DigestRow thread={thread} context={context} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// The whole row opens the Changes tab at the thread, unless its file has left the diff: then it is
// text, which says so. A refresh can move a file in or out of the diff, so the row hands focus from
// the form that leaves to the one that comes; the text holds focus without being a tab stop.
function DigestRow({ thread, context }: { thread: ReviewThread; context: Context }) {
  const focus = useFocusHandOff();
  const formRef = useMemo(() => mergeRefs(focus.from, focus.to), [focus]);
  const inDiff = context.changedPaths.has(thread.path);
  const state = [threadStateOf(thread), inDiff ? "" : "not in this diff"].filter((words) => words !== "").join(" · ");
  const row = (
    <>
      {/* Display only: `whitespace-pre` keeps the path's spaces as they are. */}
      <span className="font-mono text-xs whitespace-pre text-foreground">{threadLocationOf(thread)}</span>
      <span className="min-w-0 flex-1 truncate">{snippetOf(thread.comments[0].body)}</span>
      {state !== "" && <span className="shrink-0">{state}</span>}
    </>
  );
  return inDiff ? (
    <button ref={formRef} type="button" title={`${thread.path}: show in Changes`} onClick={() => context.onShowThread(thread)} className={`${DIGEST_ROW} cursor-pointer text-left transition-colors duration-150 ease-out hover:bg-(--pr-reviews-thread-tint-hover) hover:duration-0 ${FOCUS_RING}`}>
      {row}
    </button>
  ) : (
    <div ref={formRef} tabIndex={-1} className={`${DIGEST_ROW} ${FOCUS_RING}`}>
      {row}
    </div>
  );
}

const FOCUS_RING = "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";
const DIGEST_ROW = "flex min-h-7 min-w-0 items-baseline gap-2.5 rounded-md px-2 py-1 text-[12.5px] leading-5 text-muted-foreground";

// The first line as words: markdown's code ticks and bold marks read as noise in a one-line row.
const snippetOf = (body: string) => firstLineOf(body).replace(/`|\*\*/g, "");

const VERDICT_TONES = {
  approved: "text-success-foreground",
  "changes-requested": "text-destructive-text",
  commented: "text-muted-foreground",
  dismissed: "text-muted-foreground",
} as const satisfies Record<ReviewVerdict, string>;

const Verdict = ({ verdict }: { verdict: ReviewVerdict }) => <span className={`shrink-0 text-xs ${VERDICT_TONES[verdict]}`}>{VERDICT_WORDS[verdict]}</span>;
