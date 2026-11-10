// A review thread from GitHub where a diff draws it: each comment with its author, avatar, time
// and markdown, in order, then Reply. A resolved thread is folded to one row. A thread on several
// lines names them; one at its file says why it is there. Reply and each comment's Quote open the
// diff's one comment box here.
import { useState, type ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { linesLabel } from "../../comments/line-span.ts";
import type { FileThread } from "../../comments/place-threads.ts";
import { quoteReplyText, type GitHubComment, type LineAnchor, type ReviewThread } from "../../comments/thread-schema.ts";
import { shortSha } from "../../contract.ts";
import { timeAgo } from "../relative-time.ts";
import { ShowToggle } from "../guide/show-toggle.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { Button } from "../ui/button.tsx";
import { Prose } from "../ui/prose.tsx";

/** Reply (`quote` "") or a comment's Quote, from its button. */
export type OpenReply = (request: { quote: string; from: HTMLElement }) => void;

/** Where a diff draws the thread: under its last line, on `lines`, or at its file. */
export type ThreadPlace = { kind: "lines"; lines: LineAnchor } | { kind: "file"; placed: FileThread };

type ReviewThreadCardProps = {
  thread: ReviewThread;
  place: ThreadPlace;
  /** The diff's comment box while it is this thread's reply, which takes Reply's place. */
  box: ReactNode | null;
  onReply: OpenReply;
};

export function ReviewThreadCard({ thread, place, box, onReply }: ReviewThreadCardProps) {
  const [first] = thread.comments;
  const [shown, setShown] = useState(!thread.resolved);
  const where = place.kind === "file" ? <AtFile placed={place.placed} /> : place.lines.start === null ? null : <span>{linesOf(place.lines)}</span>;
  return (
    <section aria-label={`Review thread by ${first.author}`} className="overflow-hidden rounded-xl border border-border bg-background text-[13px] leading-5">
      {(where !== null || thread.resolved) && (
        <div className="flex min-h-9 items-center gap-2 border-b border-border px-3.5 py-1.5 text-xs text-muted-foreground">
          {where}
          {thread.resolved && (
            <>
              <span className="font-medium text-foreground">Resolved</span>
              {!shown && <span className="min-w-0 truncate">{`${first.author}: ${firstLineOf(first.body)}`}</span>}
              <div className="-my-1 ml-auto">
                <ShowToggle open={shown} subject={`resolved thread by ${first.author}`} onToggle={() => setShown(!shown)} />
              </div>
            </>
          )}
        </div>
      )}
      {shown && (
        <>
          <ol>
            {thread.comments.map((comment) => (
              <Comment key={comment.id} comment={comment} onQuote={(from) => onReply({ quote: quoteReplyText(comment.body), from })} />
            ))}
          </ol>
          <div className="border-t border-border px-2.5 py-2">
            {box ?? (
              <Button variant="ghost" size="small" onClick={(event) => onReply({ quote: "", from: event.currentTarget })}>
                Reply
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Comment({ comment, onQuote }: { comment: GitHubComment; onQuote(from: HTMLElement): void }) {
  return (
    <li className="grid gap-1.5 border-t border-border px-3.5 pt-2.5 pb-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <Avatar login={comment.author} size={20} />
        <span className="min-w-0 truncate font-semibold">{comment.author}</span>
        <UrlLink href={comment.url} title={new Date(comment.createdAt).toLocaleString()} className="shrink-0 text-xs text-subtle-foreground hover:underline">
          {timeAgo(comment.createdAt, Date.now())}
        </UrlLink>
        <div className="-my-1 ml-auto">
          <Button variant="ghost" size="small" aria-label={`Quote reply to ${comment.author}`} onClick={(event) => onQuote(event.currentTarget)}>
            Quote
          </Button>
        </div>
      </div>
      <Prose text={comment.body} className="min-w-0 pl-7" />
    </li>
  );
}

// "File", "Outdated  lines 12–13 (new) at abc1234", "Other commit  line 3 (new) at def5678".
function AtFile({ placed }: { placed: FileThread }) {
  const label = { file: "File", outdated: "Outdated", elsewhere: "Other commit" }[placed.why];
  const last = placed.why === "file" ? null : placed.last;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="rounded-sm bg-muted px-1.5 py-px font-medium text-foreground">{label}</span>
      {last !== null && <span className="min-w-0 truncate">{`${linesOf(last)} at ${shortSha(last.commit)}`}</span>}
    </span>
  );
}

const linesOf = ({ start, end }: LineAnchor) => linesLabel(start ?? end, end);

const firstLineOf = (body: string) => body.trim().split("\n")[0];
