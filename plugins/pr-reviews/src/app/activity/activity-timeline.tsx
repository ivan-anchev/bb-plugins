// The Summary tab's activity, oldest first, as the fold reads it (activity-fold.ts): a muted day
// divider over each day, messages on the page, and each run of lines in one recessed tinted block
// ("Tint"). A folded line is a button that opens in place and keeps focus; a review line opens to
// its whole review, which splits the block, with Collapse under it. A review's threads are rows in
// a tinted group, each opening the Changes tab at its thread. Which lines are open is the reader's
// one piece of state; everything else comes from the current read (REVIEW.md).
import { useMemo, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import type { ReviewVerdict } from "../../comments/timeline-schema.ts";
import { firstLineOf, GitHubCommentView, QUIET_BUTTON, TimeAgo } from "../comments/github-comment.tsx";
import { MERGED } from "../page/pr-header.tsx";
import { useFocusHandOff, type FocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import { EntryWords, glyphOf, SHA, Who } from "./activity-entry.tsx";
import { lastTimeOf, type ActivityBlock, type ActivityDay, type ActivityLine, type MergedItem, type ReviewWithThreads, type RunEntry } from "./activity-fold.ts";
import { ActivityGlyph, type ActivityGlyphName } from "./activity-glyph.tsx";
import { dayLabelOf, runSummaryOf, threadLocationOf, threadStateOf } from "./activity-words.ts";

type TimelineProps = {
  days: ActivityDay[];
  prAuthor: string;
  /** Quote on a message: its text as a quote for the composer. */
  onQuote(quote: string): void;
  /** A thread's row: show it in the Changes tab. */
  onShowThread(thread: ReviewThread): void;
};

/** What a block needs besides its own data: who wrote the PR, what is open, and the actions. */
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
          {day.blocks.map((block) => (
            <Block key={keyOf(block)} block={block} context={context} />
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

function keyOf(block: ActivityBlock): string {
  switch (block.kind) {
    case "comment":
      return block.item.id;
    case "review":
      return block.review.id;
    case "lines":
      return lineKeyOf(block.lines[0]);
    default:
      return block satisfies never;
  }
}

function lineKeyOf(line: ActivityLine): string {
  switch (line.kind) {
    case "run":
      return line.key;
    case "review":
      return line.review.id;
    case "merged":
      return line.item.id;
    default:
      return line satisfies never;
  }
}

function Block({ block, context }: { block: ActivityBlock; context: Context }) {
  switch (block.kind) {
    case "comment":
      return <Message comment={block.item.comment} verb={null} context={context} />;
    case "review":
      return <ReviewMessage review={block} context={context} />;
    case "lines":
      return <Lines lines={block.lines} context={context} />;
    default:
      return block satisfies never;
  }
}

/** A message on the page: a conversation comment, or a review with its threads under it. */
function Message({ comment, verb, context, children }: { comment: GitHubComment; verb: ReactNode; context: Context; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <GitHubCommentView
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

function ReviewMessage({ review: { review, threads }, context, children }: { review: ReviewWithThreads; context: Context; children?: ReactNode }) {
  return (
    <Message comment={review.comment} verb={<Verdict verdict={review.verdict} />} context={context}>
      {threads.length > 0 && <Digest threads={threads} onShowThread={context.onShowThread} />}
      {children}
    </Message>
  );
}

// A review's threads: one row each, its file and line, its first line, and whether it is resolved
// or outdated. The whole row opens the Changes tab at the thread.
function Digest({ threads, onShowThread }: { threads: ReviewThread[]; onShowThread(thread: ReviewThread): void }) {
  return (
    <ul aria-label="Review threads" className="col-start-2 mt-2 -ml-2 grid grid-cols-[minmax(0,1fr)] rounded-lg bg-(--pr-reviews-thread-tint) p-0.5">
      {threads.map((thread) => {
        const state = threadStateOf(thread);
        return (
          <li key={thread.id} className="grid">
            <button
              type="button"
              title={`${thread.path}: show in Changes`}
              onClick={() => onShowThread(thread)}
              className="flex min-h-7 min-w-0 cursor-pointer items-baseline gap-2.5 rounded-md px-2 py-1 text-left text-[12.5px] leading-5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-(--pr-reviews-thread-tint-hover) hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {/* Display only: `whitespace-pre` keeps the path's spaces as they are. */}
              <span className="font-mono text-xs whitespace-pre text-foreground">{threadLocationOf(thread)}</span>
              <span className="min-w-0 flex-1 truncate">{snippetOf(thread.comments[0].body)}</span>
              {state !== "" && <span className="shrink-0">{state}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// The first line as words: markdown's code ticks and bold marks read as noise in a one-line row.
const snippetOf = (body: string) => firstLineOf(body).replace(/`|\*\*/g, "");

const VERDICTS = {
  approved: { words: "approved", tone: "text-success-foreground", glyph: "approved" },
  "changes-requested": { words: "requested changes", tone: "text-destructive-text", glyph: "changes-requested" },
  commented: { words: "reviewed", tone: "text-muted-foreground", glyph: "review" },
  dismissed: { words: "reviewed", tone: "text-muted-foreground", glyph: "review" },
} as const satisfies Record<ReviewVerdict, { words: string; tone: string; glyph: ActivityGlyphName }>;

const Verdict = ({ verdict }: { verdict: ReviewVerdict }) => <span className={`shrink-0 text-xs ${VERDICTS[verdict].tone}`}>{VERDICTS[verdict].words}</span>;

// Lines in tinted blocks. A review line the reader opened shows as its review, between the blocks
// before and after it. One focus hand-off serves every review line here: only the one the reader
// pressed changes, so its line hands focus to its Collapse, and Collapse back to its line.
function Lines({ lines, context }: { lines: ActivityLine[]; context: Context }) {
  const focus = useFocusHandOff();
  const segments = useMemo(() => segmentsOf(lines, context.opened), [lines, context.opened]);
  return segments.map((segment) =>
    segment.kind === "lines" ? (
      <div key={lineKeyOf(segment.lines[0])} className="-mx-3 my-1 grid grid-cols-[minmax(0,1fr)] rounded-[10px] bg-(--pr-reviews-thread-tint) px-3 py-1">
        {segment.lines.map((line) => (
          <Line key={lineKeyOf(line)} line={line} focus={focus} context={context} />
        ))}
      </div>
    ) : (
      <div key={segment.review.review.id} ref={focus.from}>
        <ReviewMessage review={segment.review} context={context}>
          <button ref={focus.to} type="button" aria-expanded onClick={() => context.onToggle(segment.review.review.id)} className={`${QUIET_BUTTON} col-start-2 mt-1 -ml-2 justify-self-start px-2 py-0.5`}>
            Collapse
          </button>
        </ReviewMessage>
      </div>
    ),
  );
}

type Segment = { kind: "lines"; lines: ActivityLine[] } | { kind: "review"; review: ReviewWithThreads };

function segmentsOf(lines: ActivityLine[], opened: ReadonlySet<string>): Segment[] {
  const segments: Segment[] = [];
  for (const line of lines) {
    const last = segments.at(-1);
    if (line.kind === "review" && opened.has(line.review.id)) segments.push({ kind: "review", review: line });
    else if (last?.kind === "lines") last.lines.push(line);
    else segments.push({ kind: "lines", lines: [line] });
  }
  return segments;
}

function Line({ line, focus, context }: { line: ActivityLine; focus: FocusHandOff; context: Context }) {
  switch (line.kind) {
    case "run":
      return line.entries.length === 1 ? <EntryLine entry={line.entries[0]} /> : <RunLine entries={line.entries} open={context.opened.has(line.key)} onToggle={() => context.onToggle(line.key)} />;
    case "review":
      return <ReviewLine review={line} focus={focus} onOpen={() => context.onToggle(line.review.id)} />;
    case "merged":
      return <MergedLine item={line.item} />;
    default:
      return line satisfies never;
  }
}

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
function ReviewLine({ review: { review, threads }, focus, onOpen }: { review: ReviewWithThreads; focus: FocusHandOff; onOpen(): void }) {
  const verdict = VERDICTS[review.verdict];
  const words = (
    <span>
      <Who login={review.comment.author.login} /> <span className={verdict.tone}>{verdict.words}</span>
      {threads.length > 0 && ` · ${threads.length} resolved thread${threads.length === 1 ? "" : "s"}`} · <TimeAgo at={review.comment.createdAt} />
      {threads.length > 0 && <Chevron open={false} />}
    </span>
  );
  const glyph = <Glyph name={verdict.glyph} tone={review.verdict === "approved" ? verdict.tone : undefined} />;
  const ref = useMemo(() => mergeRefs(focus.from, focus.to), [focus]);
  if (threads.length === 0) {
    return (
      <div className={LINE}>
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
