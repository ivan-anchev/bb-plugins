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
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              pickForNextBox("github");
              onReply({ quote: "", from: event.currentTarget });
            }}
          >
            Reply
          </Button>
          <Button
            variant="ghost"
            size="sm"
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

const BAND = "min-w-0 border-b border-border bg-background text-sm leading-5";

const STALENESS = { file: null, outdated: "Outdated", elsewhere: "On another commit" } as const satisfies Record<FileThread["why"], string | null>;

function excerptOf(thread: ReviewThread, atFile: FileThread | null): NumberedLine[] | null {
  if (atFile === null || atFile.why === "file" || thread.subject.kind !== "lines" || thread.subject.excerpt.length === 0) return null;
  return thread.subject.excerpt;
}

const WarningBadge = ({ children }: { children: string }) => (
  <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-current/10 px-1 text-[11px] leading-3.5 font-medium text-warning-text">{children}</span>
);

type CommentsProps = {
  thread: ReviewThread;
  staleness: string | null;
  shown: GitHubComment[];
  hidden: number;
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
