// One GitHub comment as the plugin draws it, in a review thread or on the Summary tab's activity:
// its author's avatar and login, "author" for the PR's author, "bot" for an app, an optional verb
// (a review's "approved"), its time and its markdown, with Quote and the link to GitHub on the
// right. A bot's body folds to three lines.
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { GitHubComment } from "../../comments/thread-schema.ts";
import { timeAgo } from "../relative-time.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Button } from "../ui/button.tsx";
import { IconLink } from "../ui/icon-button.tsx";
import { Prose } from "../ui/prose.tsx";

/** A quiet text button, such as "N more" and Show more. */
export const QUIET_BUTTON =
  "cursor-pointer rounded-md text-xs leading-5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

/** `thread`: small, in a review thread's tint. `page`: on the page, as the activity's messages. */
type Density = "thread" | "page";

const DENSITY = {
  thread: { grid: "grid-cols-[20px_minmax(0,1fr)] gap-x-2.5", head: "min-h-5", avatar: 20, body: "max-w-[80ch]" },
  page: { grid: "grid-cols-[24px_minmax(0,1fr)] gap-x-3", head: "min-h-6 text-[13px]", avatar: 24, body: "text-sm leading-[22px]" },
} as const satisfies Record<Density, { grid: string; head: string; avatar: 20 | 24; body: string }>;

type GitHubCommentViewProps = {
  ref?: Ref<HTMLElement>;
  comment: GitHubComment;
  density: Density;
  byPrAuthor: boolean;
  /** A word after the author, such as a review's verdict. */
  verb?: ReactNode;
  onQuote(from: HTMLElement): void;
  /** Under the body, in its column: a review's threads. */
  children?: ReactNode;
};

// Quote and the link to GitHub show on hover or focus, and always where there is no hover. The
// comment is no tab stop, but can hold focus, so "N more" can hand its focus to it. A comment with
// no body (a review that only opened threads) has nothing to quote.
export function GitHubCommentView({ ref, comment, density, byPrAuthor, verb, onQuote, children }: GitHubCommentViewProps) {
  const { author } = comment;
  const sizes = DENSITY[density];
  const hasBody = comment.body.trim() !== "";
  return (
    <article ref={ref} tabIndex={-1} className={`group/comment grid ${sizes.grid} rounded-md outline-offset-4 focus-visible:outline-1 focus-visible:outline-ring`}>
      <Avatar login={author.login} size={sizes.avatar} />
      <div className={`flex min-w-0 items-center gap-1.5 ${sizes.head}`}>
        <span className="min-w-0 truncate font-medium">{author.login}</span>
        {byPrAuthor && <span className="shrink-0 text-xs text-muted-foreground">author</span>}
        {author.bot && <span className="shrink-0 text-xs text-muted-foreground">bot</span>}
        {verb}
        <TimeAgo at={comment.createdAt} className="shrink-0 text-xs text-subtle-foreground" />
        <div className="-my-1 ml-auto flex items-center opacity-0 transition-opacity duration-150 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 [@media(hover:none)]:opacity-100">
          {hasBody && (
            <Button variant="ghost" size="small" aria-label={`Quote reply to ${author.login}`} onClick={(event) => onQuote(event.currentTarget)}>
              Quote
            </Button>
          )}
          <IconLink icon="ArrowUpRight" label="Open on GitHub" href={comment.url} />
        </div>
      </div>
      {hasBody && <div className={`col-start-2 mt-0.5 min-w-0 ${sizes.body}`}>{author.bot ? <ClampedBody body={comment.body} /> : <Prose text={comment.body} />}</div>}
      {children}
    </article>
  );
}

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

// A bot's comment, often long and generated, folds to three lines with Show more, and is never
// hidden whole. The button shows only when the body is taller than the fold, whose last line fades
// out, since the fold can cut through it.
// why observers, not a layout effect: a thread under a line is a note Pierre slots into its shadow
// root after this render, so the body has no height to measure until it is drawn; and bb's Markdown
// can redraw the body's content without changing the fold's height.
// It measures only the folded body: open, the body never overflows, and Show less must stay as the
// body folds, since it keeps focus.
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

// While the body is folded, a link or control the fold hides, even in part, is inert: focus in it
// would scroll the fold and leave it faded at the bottom edge. The ones in view stay as they are.
function foldControls(field: HTMLElement, folded: boolean) {
  const edge = field.getBoundingClientRect().bottom;
  field.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((control) => {
    control.inert = folded && control.getBoundingClientRect().bottom > edge;
  });
}
