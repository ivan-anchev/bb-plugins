// A review thread from GitHub where a diff draws it, as one tinted card ("Tint"): its comments in
// order, each with its author, avatar, time and markdown, then Reply and Ask about this, which open
// the diff's one comment box under the thread, on the Send as mode each names. A long thread shows its first and latest comments
// with "N more" between; a bot's comment is clamped to three lines; a resolved thread is one row
// that opens it. A thread at its file that lost its lines says "Outdated" over the lines it was
// written on. No pills or dividers: spacing separates the comments, a ring draws the card's edge,
// and the comment box is the only raised surface (app.css holds the tint and both rings).
// Everything sits one 6px inset from the card's 12px corners: the avatars, which a diff lines up
// with its line numbers (pr-diff.tsx), and the box, whose corners are 6px, concentric with the card's.
import { useMemo, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { FileThread } from "../../comments/place-threads.ts";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import { foldOf, type Opened } from "./thread-fold.ts";
import type { NumberedLine } from "../../diff/diff-schema.ts";
import { Button } from "../ui/button.tsx";
import { useThreadReveal } from "../changes/thread-reveal.ts";
import { useFocusHandOff, type FocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import { firstLineOf, GitHubCommentView, QUIET_BUTTON } from "./github-comment.tsx";
import { pickForNextBox } from "./send-as.tsx";

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
// and back, and "N more" to the first comment it hid. A thread the reader asked to see from the
// Summary tab opens, as if they had opened it, and takes focus once drawn.
export function ReviewThreadCard({ thread, atFile, prAuthor, box, onReply }: ReviewThreadCardProps) {
  const [opened, setOpened] = useState<Opened>({ thread: false, middle: false });
  const resolvedFocus = useFocusHandOff();
  const middleFocus = useFocusHandOff();
  const reveal = useThreadReveal(thread.id);
  if (reveal.asked && !opened.thread) setOpened({ ...opened, thread: true });
  const sectionRef = useMemo(() => mergeRefs(resolvedFocus.from, reveal.target), [resolvedFocus.from, reveal.target]);
  const fold = foldOf(thread, opened);
  if (fold.kind === "row") return <ResolvedRow thread={thread} focus={resolvedFocus} onOpen={() => setOpened({ ...opened, thread: true })} />;
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={`Review thread by ${thread.comments[0].author.login}`}
      className={`${SURFACE} grid gap-2 rounded-[12px] p-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring`}
    >
      <div className="grid gap-3">
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
      </div>
      {box === null && (
        <div className="pr-reviews-thread-foot ml-5 flex items-center gap-1">
          <Button
            variant="ghost"
            size="small"
            onClick={(event) => {
              pickForNextBox("github");
              onReply({ quote: "", from: event.currentTarget });
            }}
          >
            Reply
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={(event) => {
              pickForNextBox("ask");
              onReply({ quote: "", from: event.currentTarget });
            }}
          >
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
      {box !== null && <div className="[--pr-reviews-box-radius:6px]">{box}</div>}
    </section>
  );
}

const SURFACE = "min-w-0 bg-(--pr-reviews-thread-tint) shadow-(--pr-reviews-thread-ring) text-[13px] leading-5";

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
    <ol className="grid gap-3">
      {shown.map((comment, index) => (
        <li key={comment.id} className="grid gap-3">
          <GitHubCommentView
            ref={comment === second ? focus.to : undefined}
            comment={comment}
            density="thread"
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
    <div className="grid gap-1.5">
      <p className="text-xs leading-[18px] text-subtle-foreground">{why === "outdated" ? "Outdated" : "On another commit"}</p>
      {excerpt.length > 0 && (
        // A tab stop of its own: long lines scroll sideways, and the keys scroll only the focused element.
        <div
          role="region"
          aria-label="Code the thread was written on"
          tabIndex={0}
          className="overflow-x-auto rounded-md bg-background font-mono text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {/* One width for every row, the widest line's, so each row's tint runs to the end when scrolled. */}
          <div className="w-max min-w-full">
            {excerpt.map((line, index) => (
              <ExcerptRow key={index} line={line} />
            ))}
          </div>
        </div>
      )}
    </div>
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
