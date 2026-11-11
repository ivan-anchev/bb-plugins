// The Summary tab's activity, oldest first, as the fold reads it (activity-fold.ts): a muted day
// divider over each day, messages on the page, and each run of lines in one recessed tinted block
// ("Tint"), drawn row by row (activity-rows.ts). A folded line is a button that opens in place and
// keeps focus; a review line opens to its whole review, which splits the block, with Collapse under
// it. A review's threads are rows in a tinted group, each opening the Changes tab at its thread.
// Which lines are open is the reader's one piece of state; everything else comes from the current
// read (REVIEW.md).
import { useMemo, useState, type ReactNode, type Ref, type RefCallback } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import type { ReviewVerdict } from "../../comments/timeline-schema.ts";
import { firstLineOf, GitHubCommentView, QUIET_BUTTON, TimeAgo } from "../comments/github-comment.tsx";
import { MERGED } from "../page/pr-header.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import { EntryWords, glyphOf, SHA, Who } from "./activity-entry.tsx";
import { lastTimeOf, type ActivityDay, type MergedItem, type ReviewWithThreads, type RunEntry } from "./activity-fold.ts";
import { rowsOf, type ActivityRow, type ReviewForm, type TintEdges } from "./activity-rows.ts";
import { ActivityGlyph, type ActivityGlyphName } from "./activity-glyph.tsx";
import { dayLabelOf, runSummaryOf, threadLocationOf, threadStateOf } from "./activity-words.ts";

type TimelineProps = {
  days: ActivityDay[];
  prAuthor: string;
  /** The paths the PR's diff changes: a thread on any other file has no Changes tab to open. */
  changedPaths: ReadonlySet<string>;
  /** Quote on a message: its text as a quote for the composer. */
  onQuote(quote: string): void;
  /** A thread's row: show it in the Changes tab. */
  onShowThread(thread: ReviewThread): void;
};

/** What a row needs besides its own data: who wrote the PR, the diff's paths, what is open, and the actions. */
type Context = Omit<TimelineProps, "days"> & { opened: ReadonlySet<string>; onToggle(key: string): void };

export function ActivityTimeline({ days, ...actions }: TimelineProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const onToggle = (key: string) => setOpened((current) => toggled(current, key));
  const context = { ...actions, opened, onToggle };
  const now = new Date();
  return (
    <ol className="grid grid-cols-[minmax(0,1fr)]">
      {days.map((day) => (
        <li key={day.date} className="grid grid-cols-[minmax(0,1fr)]">
          <h3 className="mt-[26px] mb-1 text-xs leading-5 font-medium text-subtle-foreground">{dayLabelOf(day.date, now)}</h3>
          {rowsOf(day.blocks, opened).map((row) => (
            <Row key={row.key} row={row} context={context} />
          ))}
        </li>
      ))}
    </ol>
  );
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

function Row({ row, context }: { row: ActivityRow; context: Context }) {
  switch (row.kind) {
    case "comment":
      return <Message comment={row.item.comment} verb={null} context={context} />;
    case "review":
      return <ReviewRow review={row.review} form={row.form} tint={row.tint} context={context} />;
    case "run":
      return (
        <div className={tintOf(row.tint)}>
          {row.entries.length === 1 ? <EntryLine entry={row.entries[0]} /> : <RunLine entries={row.entries} open={context.opened.has(row.key)} onToggle={() => context.onToggle(row.key)} />}
        </div>
      );
    case "merged":
      return (
        <div className={tintOf(row.tint)}>
          <MergedLine item={row.item} />
        </div>
      );
    default:
      return row satisfies never;
  }
}

// A line's share of its tinted block: the block's rounded ends and padding are its first and last
// rows'. A row on the page has none.
function tintOf(tint: TintEdges | null): string | undefined {
  if (tint === null) return undefined;
  const top = tint.first ? "mt-1 rounded-t-[10px] pt-1" : "";
  const bottom = tint.last ? "mb-1 rounded-b-[10px] pb-1" : "";
  return `-mx-3 grid grid-cols-[minmax(0,1fr)] bg-(--pr-reviews-thread-tint) px-3 ${top} ${bottom}`;
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

// A review in its form (activity-rows.ts). Its row stays as the form changes, whether the reader
// opens or collapses its line or a refresh resolves or reopens a thread, and hands focus from the
// form that leaves to the one that comes: to the line, to Collapse, or to the message, which holds
// focus but is no tab stop. Each form is keyed, so a change of form always replaces it whole.
function ReviewRow({ review, form, tint, context }: { review: ReviewWithThreads; form: ReviewForm; tint: TintEdges | null; context: Context }) {
  const focus = useFocusHandOff();
  const formRef = useMemo(() => mergeRefs(focus.from, focus.to), [focus]);
  const onToggle = () => context.onToggle(review.review.id);
  return (
    <div className={tintOf(tint)}>
      {form === "line" ? (
        <ReviewLine key={form} ref={formRef} review={review} onOpen={onToggle} />
      ) : (
        <div key={form} ref={focus.from}>
          <ReviewMessage ref={form === "message" ? focus.to : undefined} review={review} context={context}>
            {form === "opened" && (
              <button ref={focus.to} type="button" aria-expanded onClick={onToggle} className={`${QUIET_BUTTON} col-start-2 mt-1 -ml-2 justify-self-start px-2 py-0.5`}>
                Collapse
              </button>
            )}
          </ReviewMessage>
        </div>
      )}
    </div>
  );
}

function ReviewMessage({ ref, review: { review, threads }, context, children }: { ref?: Ref<HTMLElement>; review: ReviewWithThreads; context: Context; children?: ReactNode }) {
  return (
    <Message ref={ref} comment={review.comment} verb={<Verdict verdict={review.verdict} />} context={context}>
      {threads.length > 0 && <Digest threads={threads} context={context} />}
      {children}
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

const VERDICTS = {
  approved: { words: "approved", tone: "text-success-foreground", glyph: "approved" },
  "changes-requested": { words: "requested changes", tone: "text-destructive-text", glyph: "changes-requested" },
  commented: { words: "reviewed", tone: "text-muted-foreground", glyph: "review" },
  dismissed: { words: "reviewed", tone: "text-muted-foreground", glyph: "review" },
} as const satisfies Record<ReviewVerdict, { words: string; tone: string; glyph: ActivityGlyphName }>;

const Verdict = ({ verdict }: { verdict: ReviewVerdict }) => <span className={`shrink-0 text-xs ${VERDICTS[verdict].tone}`}>{VERDICTS[verdict].words}</span>;

const LINE = "grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 py-1 text-[12.5px] leading-5 text-muted-foreground";
const LINE_BUTTON = `${LINE} w-full cursor-pointer rounded-md text-left transition-colors duration-150 ease-out hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none`;

function Glyph({ name, tone = "text-subtle-foreground" }: { name: ActivityGlyphName; tone?: string }) {
  return (
    <span className={`grid h-5 place-items-center ${tone}`}>
      <ActivityGlyph name={name} />
    </span>
  );
}

const Chevron = ({ open }: { open: boolean }) => <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden className="ml-0.5 inline size-3.5 align-[-2px] text-subtle-foreground" />;

// A run of one is its own line, with its time.
function EntryLine({ entry }: { entry: RunEntry }) {
  return (
    <div className={LINE}>
      <Glyph name={glyphOf(entry)} />
      <span>
        <EntryWords entry={entry} /> · <TimeAgo at={lastTimeOf([entry])} />
      </span>
    </div>
  );
}

// "1 commit and 2 label changes · 6d ago ›". The button stays where it is as its list opens under
// it, so it keeps focus.
function RunLine({ entries, open, onToggle }: { entries: RunEntry[]; open: boolean; onToggle(): void }) {
  return (
    <>
      <button type="button" aria-expanded={open} onClick={onToggle} className={LINE_BUTTON}>
        <Glyph name={glyphOf(entries[0])} />
        <span>
          {runSummaryOf(entries)} · <TimeAgo at={lastTimeOf(entries)} />
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <ul className="grid gap-0.5 pb-1.5 pl-9 text-[12.5px] leading-5 text-muted-foreground">
          {entries.map((entry) => (
            <li key={entry.kind === "item" ? entry.item.id : entry.added.id} className="flex items-start gap-1.5">
              <span className="grid h-5 place-items-center text-subtle-foreground">
                <ActivityGlyph name={glyphOf(entry)} />
              </span>
              <span className="min-w-0">
                <EntryWords entry={entry} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// "X approved · 5d ago", or "X reviewed · 1 resolved thread · 6d ago ›", which opens to the review.
// A line with no threads holds focus, without being a tab stop, for the form it replaced.
function ReviewLine({ ref, review: { review, threads }, onOpen }: { ref: RefCallback<HTMLElement>; review: ReviewWithThreads; onOpen(): void }) {
  const verdict = VERDICTS[review.verdict];
  const words = (
    <span>
      <Who login={review.comment.author.login} /> <span className={verdict.tone}>{verdict.words}</span>
      {threads.length > 0 && ` · ${threads.length} resolved thread${threads.length === 1 ? "" : "s"}`} · <TimeAgo at={review.comment.createdAt} />
      {threads.length > 0 && <Chevron open={false} />}
    </span>
  );
  const glyph = <Glyph name={verdict.glyph} tone={review.verdict === "approved" ? verdict.tone : undefined} />;
  if (threads.length === 0) {
    return (
      <div ref={ref} tabIndex={-1} className={`${LINE} rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none`}>
        {glyph}
        {words}
      </div>
    );
  }
  return (
    <button ref={ref} type="button" aria-expanded={false} onClick={onOpen} className={LINE_BUTTON}>
      {glyph}
      {words}
    </button>
  );
}

function MergedLine({ item }: { item: MergedItem }) {
  return (
    <div className={LINE}>
      <Glyph name="merged" tone={MERGED} />
      <span>
        <Who login={item.actor} /> merged into <span className={`${SHA} text-foreground`}>{item.base}</span> · <TimeAgo at={item.createdAt} />
      </span>
    </div>
  );
}
