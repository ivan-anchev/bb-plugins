// A review thread from GitHub where a diff draws it, as one recessed tinted surface ("Tint"): its
// comments in order, each with its author, avatar, time and markdown, then Reply and Ask about
// this, which open the diff's one comment box under the thread. A long thread shows its first and
// latest comments with "N more" between; a bot's comment is clamped to three lines; a resolved
// thread is one row that opens it. A thread at its file that lost its lines says "Outdated" over
// the lines it was written on. No borders, pills or dividers: spacing separates the comments, and
// the comment box is the only raised surface (app.css holds the tint). The box sits 6px in from the
// card's edges, its corners concentric with the card's; the avatars sit 10px in, which a diff lines
// up with its line numbers (pr-diff.tsx).
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { FileThread } from "../../comments/place-threads.ts";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import { foldOf, type Opened } from "./thread-fold.ts";
import type { NumberedLine } from "../../diff/diff-schema.ts";
import { timeAgo } from "../relative-time.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff, type FocusHandOff } from "../ui/focus-hand-off.ts";
import { IconLink } from "../ui/icon-button.tsx";
import { Prose } from "../ui/prose.tsx";

/** Reply, Ask about this, or a comment's Quote (`quote` "" for none), from its button. */
export type OpenReply = (request: { quote: string; from: HTMLElement }) => void;

type ReviewThreadCardProps = {
  thread: ReviewThread;
  /** Why the thread is at its file, or null under its lines. */
  atFile: FileThread | null;
  /** The PR's author, whose comments say so; null while the PR is unread. */
  prAuthor: string | null;
  /** The diff's comment box while it is this thread's, which takes the footer's place. */
  box: ReactNode | null;
  onReply: OpenReply;
};

// How the thread folds comes from each read (foldOf); only what the reader opened is kept. Focus
// stays in the thread as it folds and unfolds (REVIEW.md): the resolved row hands it to Collapse
// and back, and "N more" to the first comment it hid.
export function ReviewThreadCard({ thread, atFile, prAuthor, box, onReply }: ReviewThreadCardProps) {
  const [opened, setOpened] = useState<Opened>({ thread: false, middle: false });
  const resolvedFocus = useFocusHandOff();
  const middleFocus = useFocusHandOff();
  const fold = foldOf(thread, opened);
  if (fold.kind === "row") return <ResolvedRow thread={thread} focus={resolvedFocus} onOpen={() => setOpened({ ...opened, thread: true })} />;
  return (
    <section ref={resolvedFocus.from} aria-label={`Review thread by ${thread.comments[0].author.login}`} className={`${SURFACE} rounded-[18px] px-1.5 pt-3 pb-1.5`}>
      <div className="px-1">
        {atFile !== null && atFile.why !== "file" && <Original thread={thread} why={atFile.why} />}
        <Comments
          thread={thread}
          shown={fold.shown}
          hidden={fold.hidden}
          focus={middleFocus}
          prAuthor={prAuthor}
          onShowAll={() => setOpened({ ...opened, middle: true })}
          onQuote={(comment, from) => onReply({ quote: quoteReplyText(comment.body), from })}
        />
        {box === null && (
          <div className="pr-reviews-thread-foot mt-2 mb-0.5 ml-5 flex items-center gap-1">
            <Button variant="ghost" size="small" onClick={(event) => onReply({ quote: "", from: event.currentTarget })}>
              Reply
            </Button>
            <Button variant="ghost" size="small" onClick={(event) => onReply({ quote: "", from: event.currentTarget })}>
              Ask about this
            </Button>
            {thread.resolvedBy !== null && (
              <>
                <span className="ml-auto text-xs text-muted-foreground">Resolved by {thread.resolvedBy}</span>
                <Button ref={resolvedFocus.to} variant="ghost" size="small" aria-expanded onClick={() => setOpened({ ...opened, thread: false })}>
                  Collapse
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {box !== null && <div className="mt-3">{box}</div>}
    </section>
  );
}

const SURFACE = "min-w-0 bg-(--pr-reviews-thread-tint) text-[13px] leading-5";

type CommentsProps = {
  thread: ReviewThread;
  /** The comments the fold shows, and how many it hides after the first. */
  shown: GitHubComment[];
  hidden: number;
  /** From "N more" to the second comment, the first it hid. */
  focus: FocusHandOff;
  prAuthor: string | null;
  onShowAll(): void;
  onQuote(comment: GitHubComment, from: HTMLElement): void;
};

function Comments({ thread, shown, hidden, focus, prAuthor, onShowAll, onQuote }: CommentsProps) {
  const [, second] = thread.comments;
  return (
    <ol className="grid gap-3.5">
      {shown.map((comment, index) => (
        <li key={comment.id} className="grid gap-3.5">
          <Comment
            ref={comment === second ? focus.to : undefined}
            comment={comment}
            byPrAuthor={comment.author.login === prAuthor}
            onQuote={(from) => onQuote(comment, from)}
          />
          {hidden > 0 && index === 0 && (
            <button ref={focus.from} type="button" onClick={onShowAll} className={`${QUIET_BUTTON} -my-1 ml-[22px] justify-self-start px-2 py-0.5`}>
              {hidden} more
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

const QUIET_BUTTON =
  "cursor-pointer rounded-md text-xs leading-5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

type CommentProps = { ref?: Ref<HTMLElement>; comment: GitHubComment; byPrAuthor: boolean; onQuote(from: HTMLElement): void };

// Quote and the link to GitHub show on hover or focus, and always where there is no hover. The
// comment is no tab stop, but can hold focus, so "N more" can hand its focus to it.
function Comment({ ref, comment, byPrAuthor, onQuote }: CommentProps) {
  const { author } = comment;
  return (
    <article ref={ref} tabIndex={-1} className="group/comment grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 rounded-md outline-offset-4 focus-visible:outline-1 focus-visible:outline-ring">
      <Avatar login={author.login} size={20} />
      <div className="flex min-h-5 min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-medium">{author.login}</span>
        {byPrAuthor && <span className="shrink-0 text-xs text-muted-foreground">author</span>}
        {author.bot && <span className="shrink-0 text-xs text-muted-foreground">bot</span>}
        <span title={new Date(comment.createdAt).toLocaleString()} className="shrink-0 text-xs text-subtle-foreground">
          {timeAgo(comment.createdAt, Date.now())}
        </span>
        <div className="-my-1 ml-auto flex items-center opacity-0 transition-opacity duration-150 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 [@media(hover:none)]:opacity-100">
          <Button variant="ghost" size="small" aria-label={`Quote reply to ${author.login}`} onClick={(event) => onQuote(event.currentTarget)}>
            Quote
          </Button>
          <IconLink icon="ArrowUpRight" label="Open on GitHub" href={comment.url} />
        </div>
      </div>
      <div className="col-start-2 mt-0.5 min-w-0 max-w-[80ch]">{author.bot ? <ClampedBody body={comment.body} /> : <Prose text={comment.body} />}</div>
    </article>
  );
}

// A bot's comment, often long and generated, folds to three lines with Show more, and is never
// hidden whole. The button shows only when the body is taller than the fold.
// why a ResizeObserver, not a layout effect: a thread under a line is a note Pierre slots into its
// shadow root after this render, so the body has no height to measure until it is drawn.
function ClampedBody({ body }: { body: string }) {
  const text = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const field = text.current!;
    const drawn = new ResizeObserver(() => setOverflows(field.scrollHeight > field.clientHeight + 1));
    drawn.observe(field);
    return () => drawn.disconnect();
  }, []);
  return (
    <>
      <div ref={text} className={expanded ? "" : "max-h-[60px] overflow-hidden"}>
        <Prose text={body} />
      </div>
      {(overflows || expanded) && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className={`${QUIET_BUTTON} -ml-2 mt-1 px-2 py-0.5`}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

// "Resolved · name · first line", and the count when there are replies. The whole row opens it.
// `focus`: Collapse hands its focus to the row, and the row to Collapse.
function ResolvedRow({ thread, focus, onOpen }: { thread: ReviewThread; focus: FocusHandOff; onOpen(): void }) {
  const [first] = thread.comments;
  const count = thread.comments.length;
  return (
    <section ref={focus.from} aria-label={`Resolved review thread by ${first.author.login}`} className={`${SURFACE} rounded-[10px]`}>
      <button
        ref={focus.to}
        type="button"
        aria-expanded={false}
        onClick={onOpen}
        className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[12.5px] leading-5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-(--pr-reviews-thread-tint-hover) hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="shrink-0">Resolved ·</span>
        <span className="shrink-0 font-medium text-foreground">{first.author.login}</span>
        <span className="shrink-0">·</span>
        <span className="min-w-0 flex-1 truncate">{firstLineOf(first.body)}</span>
        {count > 1 && <span className="shrink-0">{count} comments</span>}
        <Icon name="ChevronDown" className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
      </button>
    </section>
  );
}

// One muted word over the lines the thread was written on, as GitHub kept them. A thread on
// another commit's lines (a guide written before new commits) says so instead.
function Original({ thread, why }: { thread: ReviewThread; why: "outdated" | "elsewhere" }) {
  const excerpt = thread.subject.kind === "lines" ? thread.subject.excerpt : [];
  return (
    <>
      <p className="mb-1.5 text-xs leading-[18px] text-subtle-foreground">{why === "outdated" ? "Outdated" : "On another commit"}</p>
      {excerpt.length > 0 && (
        // A tab stop of its own: long lines scroll sideways, and the keys scroll only the focused element.
        <div
          role="region"
          aria-label="Code the thread was written on"
          tabIndex={0}
          className="mb-3.5 overflow-x-auto rounded-md bg-background font-mono text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {/* One width for every row, the widest line's, so each row's tint runs to the end when scrolled. */}
          <div className="w-max min-w-full">
            {excerpt.map((line, index) => (
              <ExcerptRow key={index} line={line} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const ROW_TONE: Record<string, string> = {
  "+": "bg-[color-mix(in_oklab,var(--diff-added)_16%,var(--background))]",
  "-": "bg-[color-mix(in_oklab,var(--diff-removed)_16%,var(--background))]",
};

function ExcerptRow({ line }: { line: NumberedLine }) {
  return (
    <div className={`grid grid-cols-[40px_minmax(0,1fr)] ${ROW_TONE[line.text[0]] ?? ""}`}>
      <span className="pr-2.5 text-right text-subtle-foreground select-none">{line.new ?? line.old}</span>
      <span className="pr-3 whitespace-pre">{line.text.slice(1)}</span>
    </div>
  );
}

const firstLineOf = (body: string) => body.trim().split("\n")[0];
