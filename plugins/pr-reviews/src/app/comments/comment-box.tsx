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
import { useHoldEscape } from "../ui/hold-escape.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Prose, READING_TYPE } from "../ui/prose.tsx";
import { githubActionsOf, placeholderOf, sendOptionsOf, selectedOf, sendLabelOf, type GitHubActions } from "./box-actions.ts";
import { problemsOf, type Action, type Failure } from "./box-problems.ts";
import { BOX_SHELL, DoneBox, SentNote } from "./done-box.tsx";
import { markdownShortcut } from "./markdown-keys.ts";
import { SendAs, SendButton, usePickedMode } from "./send-as.tsx";

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

export function CommentBox({ onSettled, ...props }: CommentBoxProps) {
  const pull = usePullRequest(props.head.projectId, props.head.number);
  useHoldEscape(props.subject.kind !== "conversation" || !isBlank(props.draft));
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

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const hasMod = (event: KeyboardEvent) => (MAC ? event.metaKey : event.ctrlKey) && !event.altKey;
const SEND_KEYS = MAC ? "⌘↵" : "Ctrl+↵";

type ComposerProps = Omit<CommentBoxProps, "onSettled" | "stage"> & {
  sent: BoxOutcome | null;
  onSettled(outcome: BoxOutcome, sent: string, hadFocus: boolean): void;
  pr: PrDetail;
  review: ReviewState;
};

function Composer({ subject, head, takeFocus, draft, sent, onDraft, onSettled, onClose, pr, review }: ComposerProps) {
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const caret = useTextarea(textarea, draft, !preview, takeFocus);
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
  const viewer = useComments(target).data?.viewer;
  const latch = useRef(false);
  const ids = { text: useId(), error: useId(), preview: useId() };
  const [picked, pick] = usePickedMode();

  const check = postOf(subject, pr, draft);
  const post = "blocked" in check ? null : check;
  const atHead = subject.kind !== "lines" || subject.span.commit === pr.headSha;
  const actions = githubActionsOf(subject.kind, viewer, atHead);
  const options = sendOptionsOf(subject.kind, actions, reviewThreadOf(review) !== null, atHead);
  const selected = selectedOf(options, actions, picked);
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
  const taskOf = (mode: Action): (() => Promise<BoxOutcome>) | null => {
    switch (mode) {
      case "ask":
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
  const nothingToSend = task === null || isBlank(draft);
  const send = () => {
    if (task === null || isBlank(draft) || sending) return;
    run(selected.mode, task);
  };

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
    event.preventDefault();
    event.stopPropagation();
    caret.select(edit.start, edit.end);
    onDraft(edit.text);
  };

  const togglePreview = () => {
    setPreview(!preview);
    if (preview) requestAnimationFrame(() => textarea.current!.focus());
  };

  return (
    <div ref={group} role="group" aria-label="Comment box" onKeyDown={onKeyDown} {...BOX_SHELL}>
      {subject.kind !== "conversation" && (
        <div className="absolute top-2 right-[13px] z-10">
          <IconButton icon="X" label="Discard" size="dismiss" onClick={onClose} />
        </div>
      )}
      <label htmlFor={ids.text} className="sr-only">
        {labelOf(subject)}
      </label>
      <textarea
        ref={textarea}
        id={ids.text}
        hidden={preview}
        rows={3}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        placeholder={placeholderOf(subject.kind, selected.mode)}
        aria-describedby={problems.length === 0 ? undefined : ids.error}
        className={`${TEXT_CLASS} max-h-[330px] resize-none border-0 bg-transparent placeholder:text-subtle-foreground`}
      />
      {preview && (
        <div id={ids.preview} role="region" aria-label="Preview" tabIndex={0} className={`${TEXT_CLASS} rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset`}>
          {isBlank(draft) ? <p className="text-subtle-foreground">Nothing to preview</p> : <Prose text={draft} />}
        </div>
      )}
      {post !== null && post.note !== null && <p className="px-4 pt-1 text-xs text-muted-foreground">{post.note}</p>}
      {sent !== null && <SentNote outcome={sent} />}
      {problems.length > 0 && (
        <div id={ids.error} role="alert" className="grid gap-1 px-4 pt-1">
          {problems.map((problem) => (
            <p key={problem} className="flex items-start gap-1.5 text-xs text-destructive-text">
              <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{problem}</span>
            </p>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 pt-1.5 pr-[13px] pb-2 pl-3">
        <SendAs subject={subject.kind} actions={actions} options={options} selected={selected.mode} onPick={pick} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton icon="Eye" label="Preview" aria-pressed={preview} aria-controls={preview ? ids.preview : undefined} onClick={togglePreview} />
          <SendButton label={`${label} (${SEND_KEYS})`} sending={sending} disabled={nothingToSend} onSend={send} />
        </div>
      </div>
    </div>
  );
}

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

const TEXT_CLASS = `block w-full min-h-[82px] px-4 pt-3 pr-12 pb-1 ${READING_TYPE} text-foreground outline-none`;

function useTextarea(textarea: RefObject<HTMLTextAreaElement | null>, text: string, shown: boolean, takeFocus: boolean) {
  const pending = useRef<[number, number] | null>(null);
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

function fitHeight(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}
