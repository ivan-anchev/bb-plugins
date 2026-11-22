import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { GitHubComment } from "../../comments/thread-schema.ts";
import { timeAgo } from "../relative-time.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Button } from "../ui/button.tsx";
import { IconLink } from "../ui/icon-button.tsx";
import { Prose, READING_TYPE } from "../ui/prose.tsx";

/** A quiet text button, such as "N more" and Show more. */
export const QUIET_BUTTON =
  "cursor-pointer rounded-md text-xs leading-5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

/** The avatar's column and its gap: a comment's bubble, and what lines up with it, start here. */
export const COMMENT_INDENT = "ml-9";

type GitHubCommentViewProps = {
  ref?: Ref<HTMLElement>;
  comment: GitHubComment;
  byPrAuthor: boolean;
  /** Words after the author, such as a review's verdict or a stale thread's badge. */
  verb?: ReactNode;
  onQuote(from: HTMLElement): void;
  /** Under the body, in its column: a review's threads. */
  children?: ReactNode;
};

export function GitHubCommentView({ ref, comment, byPrAuthor, verb, onQuote, children }: GitHubCommentViewProps) {
  const { author } = comment;
  const hasBody = comment.body.trim() !== "";
  return (
    <article ref={ref} tabIndex={-1} className="group/comment grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md text-sm outline-offset-4 focus-visible:outline-1 focus-visible:outline-ring">
      <Avatar login={author.login} size={24} />
      <div className="flex min-h-6 min-w-0 items-center gap-1.5">
        <span className="min-w-0 shrink-0 truncate font-medium">{author.login}</span>
        {byPrAuthor && <span className="shrink-0 text-muted-foreground">author</span>}
        {author.bot && <span className="shrink-0 text-muted-foreground">bot</span>}
        {comment.pending && <PendingBadge />}
        {verb}
        <TimeAgo at={comment.createdAt} className="shrink-0 text-subtle-foreground" />
        <div className="-my-1 ml-auto flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 [@media(hover:none)]:opacity-100">
          {hasBody && (
            <Button variant="ghost" size="sm" aria-label={`Quote reply to ${author.login}`} onClick={(event) => onQuote(event.currentTarget)}>
              Quote
            </Button>
          )}
          <IconLink icon="ArrowUpRight" label="Open on GitHub" href={comment.url} />
        </div>
      </div>
      {hasBody && (
        <div className={`col-start-2 min-w-0 rounded-xl bg-surface-recessed px-3.5 py-2.5 ${READING_TYPE}`}>
          {author.bot ? <ClampedBody body={comment.body} /> : <Prose text={comment.body} />}
        </div>
      )}
      {children}
    </article>
  );
}

function PendingBadge() {
  return (
    <span title="Only you can see this until you submit your review" className={`shrink-0 rounded-full px-1.5 text-[11px] leading-4 font-medium ${PENDING_TONE}`}>
      Pending
    </span>
  );
}

/** Pending's colours: the theme's warning text, on a wash and inside a ring of itself. */
export const PENDING_TONE = "bg-[color-mix(in_oklab,var(--warning-text)_12%,transparent)] text-warning-text inset-ring inset-ring-[color-mix(in_oklab,var(--warning-text)_35%,transparent)]";

const FADE_LAST_LINE = "[mask-image:linear-gradient(to_bottom,#000_calc(100%-1lh),transparent)]";

/** "5m ago", with the date and time on hover. */
export function TimeAgo({ at, className }: { at: string; className?: string }) {
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()} className={className}>
      {timeAgo(at, Date.now())}
    </time>
  );
}

/** A comment's first line, as a row that stands for it shows it. */
export const firstLineOf = (body: string) => body.trim().split("\n")[0];

function ClampedBody({ body }: { body: string }) {
  const text = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expanded) return;
    const field = text.current!;
    const fold = () => {
      setOverflows(field.scrollHeight > field.clientHeight + 1);
      foldControls(field, true);
    };
    const drawn = new ResizeObserver(fold);
    const redrawn = new MutationObserver(fold);
    drawn.observe(field);
    redrawn.observe(field, { childList: true, subtree: true });
    return () => {
      drawn.disconnect();
      redrawn.disconnect();
      foldControls(field, false);
    };
  }, [expanded]);
  return (
    <>
      <div ref={text} className={expanded ? "" : `max-h-[3lh] overflow-hidden ${overflows ? FADE_LAST_LINE : ""}`}>
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

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

function foldControls(field: HTMLElement, folded: boolean) {
  const edge = field.getBoundingClientRect().bottom;
  field.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((control) => {
    control.inert = folded && control.getBoundingClientRect().bottom > edge;
  });
}
