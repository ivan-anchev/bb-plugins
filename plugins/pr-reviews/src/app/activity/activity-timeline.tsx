import { useMemo, useState, type ReactNode, type Ref } from "react";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import type { ReviewVerdict } from "../../comments/timeline-schema.ts";
import { firstLineOf, GitHubCommentView } from "../comments/github-comment.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import { Prose, READING_TYPE } from "../ui/prose.tsx";
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
            {connector?.up && <span aria-hidden className={`top-0 h-2.25 ${CONNECTOR}`} />}
            {connector?.down && <span aria-hidden className={`top-6.75 bottom-0 ${CONNECTOR}`} />}
            <Part part={part} context={context} />
          </li>
        );
      })}
    </ol>
  );
}

const CONNECTOR = "absolute left-3 w-px -translate-x-1/2 bg-border";

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

function Message({ ref, comment, verb, context, children }: { ref?: Ref<HTMLElement>; comment: GitHubComment; verb: ReactNode; context: Context; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <GitHubCommentView
        ref={ref}
        comment={comment}
        byPrAuthor={comment.author.login === context.prAuthor}
        verb={verb}
        onQuote={() => context.onQuote(quoteReplyText(comment.body))}
      >
        {children}
      </GitHubCommentView>
    </div>
  );
}

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

function Digest({ threads, context }: { threads: ReviewThread[]; context: Context }) {
  return (
    <ul aria-label="Review threads" className="col-start-2 mt-2 -ml-2 grid grid-cols-[minmax(0,1fr)] rounded-lg bg-card p-0.5">
      {threads.map((thread) => (
        <li key={thread.id} className="grid">
          <DigestRow thread={thread} wraps={false} context={context} />
        </li>
      ))}
    </ul>
  );
}

function ReviewFold({ review: { review, threads }, context }: { review: ReviewWithThreads; context: Context }) {
  const hasBody = review.comment.body.trim() !== "";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] pb-1.5 pl-9">
      {hasBody && <Prose text={review.comment.body} className={`pb-1 ${READING_TYPE}`} />}
      <ul aria-label="Review threads" className="@container -ml-2 grid grid-cols-[minmax(0,1fr)]">
        {threads.map((thread) => (
          <li key={thread.id} className="grid">
            <DigestRow thread={thread} wraps context={context} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DigestRow({ thread, wraps, context }: { thread: ReviewThread; wraps: boolean; context: Context }) {
  const focus = useFocusHandOff();
  const formRef = useMemo(() => mergeRefs(focus.from, focus.to), [focus]);
  const inDiff = context.changedPaths.has(thread.path);
  const state = [threadStateOf(thread), inDiff ? "" : "not in this diff"].filter((words) => words !== "").join(" · ");
  const row = (
    <>
      <span className="font-mono text-xs whitespace-pre text-foreground">{threadLocationOf(thread)}</span>
      <span className={wraps ? `${SNIPPET} ${NARROW_SNIPPET}` : SNIPPET}>{snippetOf(thread.comments[0].body)}</span>
      {state !== "" && <span className="shrink-0">{state}</span>}
    </>
  );
  const layout = wraps ? `${DIGEST_ROW} ${NARROW_ROW}` : DIGEST_ROW;
  return inDiff ? (
    <button ref={formRef} type="button" title={`${thread.path}: show in Changes`} onClick={() => context.onShowThread(thread)} className={`${layout} cursor-pointer text-left transition-colors duration-150 ease-out hover:bg-state-hover hover:duration-0 ${FOCUS_RING}`}>
      {row}
    </button>
  ) : (
    <div ref={formRef} tabIndex={-1} className={`${layout} ${FOCUS_RING}`}>
      {row}
    </div>
  );
}

const FOCUS_RING = "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";
const DIGEST_ROW = "flex min-h-7 min-w-0 items-baseline gap-2.5 rounded-md px-2 py-1 text-xs leading-5 text-muted-foreground";
const SNIPPET = "min-w-0 flex-1 truncate";
const NARROW_ROW = "@max-[480px]:flex-wrap @max-[480px]:gap-y-0.5";
const NARROW_SNIPPET = "@max-[480px]:order-last @max-[480px]:basis-full";

const snippetOf = (body: string) => firstLineOf(body).replace(/`|\*\*/g, "");

const VERDICT_TONES = {
  approved: "text-success",
  "changes-requested": "text-destructive-text",
  commented: "text-muted-foreground",
  dismissed: "text-muted-foreground",
} as const satisfies Record<ReviewVerdict, string>;

const Verdict = ({ verdict }: { verdict: ReviewVerdict }) => <span className={`shrink-0 text-xs ${VERDICT_TONES[verdict]}`}>{VERDICT_WORDS[verdict]}</span>;
