// A review thread from GitHub where a diff draws it, as Zeron draws a conversation: a band of the
// page's background across the diff, edge to edge, with its comments in order, each an avatar and a
// line of who and when over a borderless bubble, a timeline line joining the avatars. A thread
// whose lines are stale says so with a warning badge on its first comment ("Outdated"). Then Reply
// and Ask about this, which open the diff's one comment box under the thread. A thread at its file
// that lost its lines opens with them, drawn as the diff draws code. A long thread shows its first
// and latest comments with "N more" between; a bot's comment is clamped to three lines; a resolved
// thread is one row that opens it. The band draws only its bottom edge: the diff's note draws the
// top (pr-diff.tsx).
import { useMemo, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { FileThread } from "../../comments/place-threads.ts";
import { quoteReplyText, type GitHubComment, type ReviewThread } from "../../comments/thread-schema.ts";
import { foldOf, type Opened } from "./thread-fold.ts";
import { Button } from "../ui/button.tsx";
import { useThreadReveal } from "../changes/thread-reveal.ts";
import { useFocusHandOff, type FocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import type { NumberedLine } from "../../diff/diff-schema.ts";
import { COMMENT_INDENT, firstLineOf, GitHubCommentView, QUIET_BUTTON } from "./github-comment.tsx";
import { OutdatedCode } from "./outdated-code.tsx";

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
  const excerpt = excerptOf(thread, atFile);
  if (fold.kind === "row") return <ResolvedRow thread={thread} focus={resolvedFocus} onOpen={() => setOpened({ ...opened, thread: true })} />;
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={`Review thread by ${thread.comments[0].author.login}`}
      // why `minmax(0,1fr)`: an implicit `auto` track grows to the outdated code's widest line, so
      // the code would widen the thread, not scroll in it.
      className={`${BAND} grid grid-cols-[minmax(0,1fr)] gap-4 pb-3 ${excerpt === null ? "pt-3" : ""} outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset`}
    >
      {excerpt !== null && (
        <div className="border-b border-border-seam">
          <OutdatedCode path={thread.path} excerpt={excerpt} />
        </div>
      )}
      <Comments
        thread={thread}
        staleness={atFile === null ? null : STALENESS[atFile.why]}
        shown={fold.shown}
        hidden={fold.hidden}
        focus={middleFocus}
        prAuthor={prAuthor}
        onShowAll={() => setOpened({ ...opened, middle: true })}
        onQuote={(comment, from) => onReply({ quote: quoteReplyText(comment.body), from })}
      />
      {box === null ? (
        <div className={`${COMMENT_INDENT} -ml-3 flex items-center gap-1 px-3`}>
          <Button variant="ghost" size="sm" onClick={(event) => onReply({ quote: "", from: event.currentTarget })}>
            Reply
          </Button>
          <Button variant="ghost" size="sm" onClick={(event) => onReply({ quote: "", from: event.currentTarget })}>
            Ask about this
          </Button>
          {thread.resolvedBy !== null && (
            <>
              <span className="ml-auto text-xs text-muted-foreground">Resolved by {thread.resolvedBy}</span>
              <Button ref={resolvedFocus.to} variant="ghost" size="sm" aria-expanded onClick={() => setOpened({ ...opened, thread: false })}>
                Collapse
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className={`${COMMENT_INDENT} px-3`}>{box}</div>
      )}
    </section>
  );
}

// The band: the page's background, as under Zeron's conversation, with a hairline under it.
const BAND = "min-w-0 border-b border-border bg-background text-sm leading-5";

// Why a thread at its file is there, when its lines are stale: a thread on the whole file is not.
const STALENESS = { file: null, outdated: "Outdated", elsewhere: "On another commit" } as const satisfies Record<FileThread["why"], string | null>;

/** The lines a thread at its file was written on, which it opens with; null under its lines, on the file, or with none kept. */
function excerptOf(thread: ReviewThread, atFile: FileThread | null): NumberedLine[] | null {
  if (atFile === null || atFile.why === "file" || thread.subject.kind !== "lines" || thread.subject.excerpt.length === 0) return null;
  return thread.subject.excerpt;
}

/** A warning badge, as bb's state badges draw one: the warning colour on a 10% wash of it. */
const WarningBadge = ({ children }: { children: string }) => (
  <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-current/10 px-1 text-[11px] leading-3.5 font-medium text-warning-text">{children}</span>
);

type CommentsProps = {
  thread: ReviewThread;
  /** Why the thread's lines are stale, said by a badge on its first comment, or null. */
  staleness: string | null;
  /** The comments the fold shows, and how many it hides after the first. */
  shown: GitHubComment[];
  hidden: number;
  /** From "N more" to the second comment, the first it hid. */
  focus: FocusHandOff;
  prAuthor: string | null;
  onShowAll(): void;
  onQuote(comment: GitHubComment, from: HTMLElement): void;
};

function Comments({ thread, staleness, shown, hidden, focus, prAuthor, onShowAll, onQuote }: CommentsProps) {
  const [first, second] = thread.comments;
  return (
    <ol className="grid gap-4 px-3">
      {shown.map((comment, index) => (
        <li key={comment.id} className="relative grid gap-4">
          {/* The timeline, as Zeron draws one: avatar to avatar, a 4px gap at each end. */}
          {index < shown.length - 1 && <span aria-hidden className="absolute top-7 -bottom-3 left-3 w-px -translate-x-1/2 bg-border" />}
          <GitHubCommentView
            ref={comment === second ? focus.to : undefined}
            comment={comment}
            byPrAuthor={comment.author.login === prAuthor}
            verb={comment === first && staleness !== null ? <WarningBadge>{staleness}</WarningBadge> : undefined}
            onQuote={(from) => onQuote(comment, from)}
          />
          {hidden > 0 && index === 0 && (
            <button ref={focus.from} type="button" onClick={onShowAll} className={`${QUIET_BUTTON} ${COMMENT_INDENT} -my-2 justify-self-start px-2 py-0.5`}>
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
    <section ref={focus.from} aria-label={`Resolved review thread by ${first.author.login}`} className={BAND}>
      <button
        ref={focus.to}
        type="button"
        aria-expanded={false}
        onClick={onOpen}
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs leading-5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
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
