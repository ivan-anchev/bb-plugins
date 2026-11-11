// The comment box: a diff's one box, under its selected lines or in one of its review threads, or
// the Summary tab's composer. Write in markdown, preview it, pick what it goes as (send-as.tsx), then
// send it: ask the review thread about the lines, comment on them on GitHub, reply in the thread,
// or comment on the PR's conversation; or add the comment or reply to the reader's pending review
// (box-actions.ts). A diff's draft is the diff's, so it follows the box from place to place. Once
// the box has done its job it shows the outcome in the same shell, where the text was.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { experimental_Icon as Icon, experimental_PluginRpcCallError as RpcCallError } from "@get-bb/plugin-sdk/app";
import { reviewThreadOf, type PrDetail, type ReviewState } from "../../contract.ts";
import type { CommentRequest } from "../../comments/comment-schema.ts";
import { quoteOf, type LineSpan } from "../../comments/line-span.ts";
import { checkComment, checkConversationComment, checkReply, type BlockedComment, type ConversationRequest, type ReplyRequest } from "../../comments/plan-comment.ts";
import type { ReviewThread } from "../../comments/thread-schema.ts";
import { isBlank, type BoxOutcome, type BoxStage } from "../diff/line-selection.ts";
import { useLifetime } from "../lifetime.ts";
import {
  useAddReplyToReview,
  useAddToReview,
  useAskAboutFinding,
  useAskAboutGitHubThread,
  useAskAboutLines,
  useComments,
  usePostComment,
  usePostConversationComment,
  usePullRequest,
  useReplyToThread,
  type PrHeadTarget,
} from "../queries.ts";
import { Button } from "../ui/button.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Prose } from "../ui/prose.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { githubActionsOf, placeholderOf, segmentsOf, selectedOf, sendLabelOf, type GitHubActions } from "./box-actions.ts";
import { problemsOf, type Action, type Failure } from "./box-problems.ts";
import { BOX_CLASS, DoneBox, SentNote } from "./done-box.tsx";
import { markdownShortcut } from "./markdown-keys.ts";
import { SendAs, SendButton, usePickedMode } from "./send-as.tsx";
import { useWriteTabs, WriteTabs } from "./write-tabs.tsx";

/**
 * What the box is about: the lines under it, at the commit the reader views, the review thread it
 * replies in, or the PR's conversation, where it only comments.
 */
export type BoxSubject = { kind: "lines"; span: LineSpan; finding: number | null } | { kind: "reply"; thread: ReviewThread } | { kind: "conversation" };

type CommentBoxProps = {
  subject: BoxSubject;
  head: PrHeadTarget;
  stage: BoxStage;
  /** The box takes focus as it is drawn: it was opened, rather than drawn with the page. */
  takeFocus: boolean;
  draft: string;
  onDraft(draft: string): void;
  /** The question was sent, or the comment posted: `sent` is the text that went. */
  onSettled(outcome: BoxOutcome, sent: string): void;
  /** × or Esc in an empty box, or Done. */
  onClose(): void;
};

// The page draws only once the PR is read, and this is the same cache entry, so it is there.
export function CommentBox({ onSettled, ...props }: CommentBoxProps) {
  const pull = usePullRequest(props.head.projectId, props.head.number);
  // The composer is always there: it holds Esc only while it holds a draft.
  useHoldEscape(props.subject.kind !== "conversation" || !isBlank(props.draft));
  // why remember it: Done takes focus only from a composer that had it, which goes as Done comes.
  // Focus the reader has taken elsewhere meanwhile, such as into another diff's box, stays there.
  const [focusDone, setFocusDone] = useState(false);
  if (pull.data === undefined) return null;
  const { stage } = props;
  if (stage.kind === "done") return <DoneBox outcome={stage.outcome} takeFocus={focusDone} onDone={props.onClose} />;
  const settle = (outcome: BoxOutcome, sent: string, hadFocus: boolean) => {
    setFocusDone(hadFocus);
    onSettled(outcome, sent);
  };
  return <Composer {...props} sent={stage.sent} onSettled={settle} pr={pull.data.pr} review={pull.data.review} />;
}

// why ⌘ on a Mac and Ctrl elsewhere, never both: Ctrl+E and Ctrl+B move the caret in a Mac textarea.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const hasMod = (event: KeyboardEvent) => (MAC ? event.metaKey : event.ctrlKey) && !event.altKey;
const SEND_KEYS = MAC ? "⌘↵" : "Ctrl+↵";

type ComposerProps = Omit<CommentBoxProps, "onSettled" | "stage"> & {
  /** A request that went while the reader changed the draft, which the box still holds. */
  sent: BoxOutcome | null;
  /** `hadFocus`: focus was in the box when the reply came. */
  onSettled(outcome: BoxOutcome, sent: string, hadFocus: boolean): void;
  pr: PrDetail;
  review: ReviewState;
};

// The draft goes as the selected mode, by the send button or ⌘↵, markdown included. A failure
// stays beside the kept draft until the draft changes. A reply that lands after the box has moved
// or closed changes nothing: the box is no longer the one that sent it.
function Composer({ subject, head, takeFocus, draft, sent, onDraft, onSettled, onClose, pr, review }: ComposerProps) {
  const tabs = useWriteTabs();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const caret = useTextarea(textarea, draft, tabs.tab === "write", takeFocus);
  const life = useLifetime();
  const askLines = useAskAboutLines();
  const askFinding = useAskAboutFinding();
  const askThread = useAskAboutGitHubThread();
  const postComment = usePostComment();
  const reply = useReplyToThread();
  const postConversationComment = usePostConversationComment();
  const addToReview = useAddToReview();
  const addReplyToReview = useAddReplyToReview();
  const target = { projectId: head.projectId, number: head.number };
  // The same cache entry as the diff's threads: the reader's review comes with them.
  const viewer = useComments(target).data?.viewer;
  // why a latch beside `sending`: the state arrives with the next render, so a quick second click
  // would send twice.
  const latch = useRef(false);
  const ids = { text: useId(), error: useId() };
  const [picked, pick] = usePickedMode();

  const check = postOf(subject, pr, draft);
  const post = "blocked" in check ? null : check;
  const atHead = subject.kind !== "lines" || subject.span.commit === pr.headSha;
  const actions = githubActionsOf(subject.kind, viewer, atHead);
  const segments = segmentsOf(subject.kind, actions, reviewThreadOf(review) !== null, atHead);
  const selected = selectedOf(segments, actions, picked);
  const write = reviewWriteOf(actions, post);
  const problems = problemsOf("blocked" in check ? check.blocked : null, failure, draft);
  const label = sendLabelOf(subject.kind, selected.mode);

  const run = (action: Action, request: () => Promise<BoxOutcome>) => {
    if (latch.current) return;
    latch.current = true;
    setSending(true);
    setFailure(null);
    const text = draft;
    void request()
      .then(
        life.bind((outcome: BoxOutcome) => {
          setSending(false);
          onSettled(outcome, text, group.current!.contains(document.activeElement));
        }),
        life.bind((error: unknown) => {
          setSending(false);
          setFailure({ action, message: RpcCallError.from(error).message, draft: text });
        }),
      )
      .finally(() => (latch.current = false));
  };
  // What sending as `mode` does, or null when there is nothing it can send.
  const taskOf = (mode: Action): (() => Promise<BoxOutcome>) | null => {
    switch (mode) {
      case "ask":
        // A comment on the conversation is about nothing the review thread could answer.
        return subject.kind === "conversation"
          ? null
          : async () => {
              await askAbout(subject);
              return { kind: "asked" };
            };
      case "comment":
        return post === null ? null : async () => ({ kind: "commented", url: (await publish(post)).url });
      case "review":
        return write === null
          ? null
          : async () => {
              await addToTheReview(write);
              return { kind: "reviewed" };
            };
      default:
        return mode satisfies never;
    }
  };
  // A box a finding's button opened, still on its line, asks about the finding, so the thread
  // knows which; a box in a GitHub thread asks about that thread.
  const askAbout = (subject: Exclude<BoxSubject, { kind: "conversation" }>) => {
    if (subject.kind === "reply") return askThread.mutate({ ...target, thread: subject.thread, question: draft });
    if (subject.finding === null) return askLines.mutate({ ...target, quote: quoteOf(subject.span), question: draft });
    return askFinding.mutate({ ...target, headSha: head.headSha, findingIndex: subject.finding, question: draft });
  };
  const addToTheReview = (write: ReviewWrite) => {
    switch (write.kind) {
      case "comment":
        return addToReview.mutate({ ...target, request: write.request, reviewId: write.reviewId });
      case "reply":
        return addReplyToReview.mutate({ ...target, threadId: write.threadId, reviewId: write.reviewId, body: write.body });
      default:
        return write satisfies never;
    }
  };
  const publish = (post: Post) => {
    switch (post.kind) {
      case "comment":
        return postComment.mutate({ ...target, request: post.request });
      case "reply":
        return reply.mutate({ ...target, ...post.request });
      case "conversation":
        return postConversationComment.mutate({ ...target, ...post.request });
      default:
        return post satisfies never;
    }
  };
  const task = selected.reason === null ? taskOf(selected.mode) : null;
  const canSend = task !== null && !isBlank(draft) && !sending;
  const send = () => {
    if (task === null || !canSend) return;
    run(selected.mode, task);
  };

  // why on the box, not the textarea: Esc and ⌘↵ are the box's wherever in it focus is. Esc is
  // claimed here as well as by the hold: an Esc that closes the box takes its hold with it before
  // the event gets that far, and bb's own Esc would leave the page.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (isBlank(draft)) onClose();
      return;
    }
    if (!hasMod(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      send();
      return;
    }
    const field = textarea.current!;
    const edit = event.target === field ? markdownShortcut(event.key, { text: draft, start: field.selectionStart, end: field.selectionEnd }) : null;
    if (edit === null) return;
    // why stop it here: ⌘K and the like are bb's shortcuts too, and this one is the textarea's.
    event.preventDefault();
    event.stopPropagation();
    caret.select(edit.start, edit.end);
    onDraft(edit.text);
  };

  return (
    // why a size container: under 470px wide, Send as draws its segments as icons alone.
    <div ref={group} role="group" aria-label="Comment box" onKeyDown={onKeyDown} className={`@container ${BOX_CLASS}`}>
      <div className="flex items-center px-2 pt-2">
        <WriteTabs tabs={tabs} onWrite={() => textarea.current!.focus()} />
        {subject.kind !== "conversation" && (
          <div className="ml-auto">
            <IconButton icon="X" label="Discard" size="dismiss" onClick={onClose} />
          </div>
        )}
      </div>
      <div hidden={tabs.tab !== "write"} {...tabs.panelProps("write")}>
        <label htmlFor={ids.text} className="sr-only">
          {labelOf(subject)}
        </label>
        <textarea
          ref={textarea}
          id={ids.text}
          rows={3}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder={placeholderOf(subject.kind, selected.mode)}
          aria-describedby={problems.length === 0 ? undefined : ids.error}
          className={`${TEXT_CLASS} max-h-[330px] resize-none border-0 bg-transparent placeholder:text-subtle-foreground`}
        />
      </div>
      {tabs.tab === "preview" && (
        // why its own tab stop: it is a tab panel of text alone, and the keys reach it only so (REVIEW.md).
        <div {...tabs.panelProps("preview")} tabIndex={0} className={`${TEXT_CLASS} rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset`}>
          {isBlank(draft) ? <p className="text-subtle-foreground">Nothing to preview</p> : <Prose text={draft} />}
        </div>
      )}
      {post !== null && post.note !== null && <p className="px-[18px] pt-1 text-xs text-muted-foreground">{post.note}</p>}
      {sent !== null && <SentNote outcome={sent} />}
      <div className="flex min-h-11 items-center gap-2 pt-1.5 pr-2 pb-2 pl-[18px]">
        {problems.length > 0 && (
          <div id={ids.error} role="alert" className="mr-auto grid min-w-0 gap-1">
            {problems.map((problem) => (
              <p key={problem} className="flex items-start gap-1.5 text-xs text-destructive-text">
                <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>{problem}</span>
              </p>
            ))}
          </div>
        )}
        {/* why aria-disabled, not disabled: the send button stays focusable, and says what it would send as. */}
        {segments.length === 1 ? (
          <div className="ml-auto">
            <Tooltip content={`${label} on GitHub (${SEND_KEYS})`} placement="top-end">
              {(describedBy) => (
                <Button variant="primary" size="small" aria-disabled={!canSend} aria-describedby={describedBy} onClick={send}>
                  <Icon name="GithubLogo" className="size-3.5" aria-hidden />
                  {sending ? "Commenting…" : label}
                </Button>
              )}
            </Tooltip>
          </div>
        ) : (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <SendAs segments={segments} selected={selected.mode} onPick={pick} />
            <SendButton label={`${label} (${SEND_KEYS})`} sending={sending} disabled={!canSend} onSend={send} />
          </div>
        )}
      </div>
    </div>
  );
}

/** What Comment posts: a review comment on the lines, a reply in the thread (`threadId`, its node id), or a comment on the conversation. */
type Post =
  | { kind: "comment"; request: CommentRequest; note: string | null }
  | { kind: "reply"; request: ReplyRequest; threadId: string; note: null }
  | { kind: "conversation"; request: ConversationRequest; note: null };

function postOf(subject: BoxSubject, pr: PrDetail, draft: string): Post | BlockedComment {
  switch (subject.kind) {
    case "lines": {
      const check = checkComment(subject.span, pr, draft);
      return "blocked" in check ? check : { kind: "comment", ...check };
    }
    case "reply": {
      const check = checkReply(subject.thread, draft);
      return "blocked" in check ? check : { kind: "reply", request: check.request, threadId: subject.thread.id, note: null };
    }
    case "conversation": {
      const check = checkConversationComment(draft);
      return "blocked" in check ? check : { kind: "conversation", request: check.request, note: null };
    }
    default:
      return subject satisfies never;
  }
}

/**
 * What Review writes: a comment in the pending review, or in one GitHub starts (null); or a
 * reply, which joins only a pending review, since without one GitHub would publish it.
 */
type ReviewWrite = { kind: "comment"; request: CommentRequest; reviewId: string | null } | { kind: "reply"; threadId: string; reviewId: string; body: string };

function reviewWriteOf(actions: GitHubActions, post: Post | null): ReviewWrite | null {
  if (post === null || actions.kind === "publish") return null;
  const reviewId = actions.kind === "review" ? actions.reviewId : null;
  switch (post.kind) {
    case "comment":
      return { kind: "comment", request: post.request, reviewId };
    case "reply":
      return reviewId === null ? null : { kind: "reply", threadId: post.threadId, reviewId, body: post.request.body };
    case "conversation":
      return null;
    default:
      return post satisfies never;
  }
}

function labelOf(subject: BoxSubject): string {
  switch (subject.kind) {
    case "lines":
      return `Comment or question about ${subject.span.rows.length === 1 ? "this line" : "these lines"}`;
    case "reply":
      return `Reply or question about the thread by ${subject.thread.comments[0].author.login}`;
    case "conversation":
      return "Comment on this pull request";
    default:
      return subject satisfies never;
  }
}

/**
 * Write and Preview share type, padding and minimum height, so switching moves nothing. The minimum
 * is the textarea's three rows: 3 × 22px of line, and 8px + 4px of padding.
 */
const TEXT_CLASS = "block w-full min-h-[78px] px-[18px] pt-2 pb-1 text-[13px] leading-[22px] text-foreground outline-none";

/**
 * The textarea's focus, height and selection. It takes focus with the caret at the end when the
 * box opens (`takeFocus`), grows with its text to its max height and then scrolls, and `select`
 * places the selection once the text a shortcut changed is drawn. `shown`: the Write tab is
 * selected; a hidden textarea has no height to measure.
 */
function useTextarea(textarea: RefObject<HTMLTextAreaElement | null>, text: string, shown: boolean, takeFocus: boolean) {
  const pending = useRef<[number, number] | null>(null);
  // why wait for a size, not autoFocus or a plain effect: the box is a note Pierre slots into its
  // shadow root on its own render, after this one. Until then the textarea is not drawn: it can't
  // take focus, and has no height to fit.
  useEffect(() => {
    const field = textarea.current!;
    const drawn = new ResizeObserver(() => {
      if (field.getClientRects().length === 0) return;
      drawn.disconnect();
      fitHeight(field);
      if (!takeFocus) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    drawn.observe(field);
    return () => drawn.disconnect();
  }, [textarea, takeFocus]);
  useLayoutEffect(() => {
    if (!shown) return;
    const field = textarea.current!;
    fitHeight(field);
    if (pending.current === null) return;
    field.setSelectionRange(...pending.current);
    pending.current = null;
  }, [textarea, text, shown]);
  return { select: (start: number, end: number) => (pending.current = [start, end]) };
}

// Its text's height; the max height caps it, and past that it scrolls.
function fitHeight(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}
