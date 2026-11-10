// A diff's one comment box, under its selected lines: write in markdown, preview it, then ask the
// review thread about the lines or comment on them on GitHub. The draft is the diff's, so it
// follows the box from lines to lines. Once the box has done its job it shows the outcome in the
// same shell, where the text was.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { experimental_Icon as Icon, experimental_PluginRpcCallError as RpcCallError } from "@get-bb/plugin-sdk/app";
import { reviewThreadOf, type PrDetail, type ReviewState } from "../../contract.ts";
import { quoteOf, type LineSpan } from "../../comments/line-span.ts";
import { checkComment } from "../../comments/plan-comment.ts";
import { isBlank, type BoxOutcome, type LineBox } from "../diff/line-selection.ts";
import { useLifetime } from "../lifetime.ts";
import { useAskAboutFinding, useAskAboutLines, usePostComment, usePullRequest, type PrHeadTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Prose } from "../ui/prose.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { problemsOf, type Action, type Failure } from "./box-problems.ts";
import { BOX_CLASS, DoneBox, SentNote } from "./done-box.tsx";
import { markdownShortcut } from "./markdown-keys.ts";
import { useWriteTabs, WriteTabs } from "./write-tabs.tsx";

type CommentBoxProps = {
  /** The lines under the box, at the commit the reader views. */
  span: LineSpan;
  head: PrHeadTarget;
  box: LineBox;
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
  useHoldEscape();
  // why remember it: Done takes focus only from a composer that had it, which goes as Done comes.
  // Focus the reader has taken elsewhere meanwhile, such as into another diff's box, stays there.
  const [focusDone, setFocusDone] = useState(false);
  if (pull.data === undefined) return null;
  const { stage } = props.box;
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
const COMMENT_KEYS = MAC ? "⌘↵" : "Ctrl+↵";

type ComposerProps = Omit<CommentBoxProps, "onSettled"> & {
  /** A request that went while the reader changed the draft, which the box still holds. */
  sent: BoxOutcome | null;
  /** `hadFocus`: focus was in the box when the reply came. */
  onSettled(outcome: BoxOutcome, sent: string, hadFocus: boolean): void;
  pr: PrDetail;
  review: ReviewState;
};

// Both actions take the draft as it is, markdown included. A failure stays beside the kept draft
// until the draft changes. A reply that lands after the box has moved or closed changes nothing:
// the box is no longer the one that sent it.
function Composer({ span, head, box, draft, sent, onDraft, onSettled, onClose, pr, review }: ComposerProps) {
  const tabs = useWriteTabs();
  const [sending, setSending] = useState<Action | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const caret = useTextarea(textarea, draft, tabs.tab === "write");
  const life = useLifetime();
  const askLines = useAskAboutLines();
  const askFinding = useAskAboutFinding();
  const post = usePostComment();
  // why a latch beside `sending`: the state arrives with the next render, so a quick second click
  // would send twice.
  const latch = useRef(false);
  const ids = { text: useId(), error: useId(), noThread: useId() };

  const check = useMemo(() => checkComment(span, pr, draft), [span, pr, draft]);
  const { request, note } = "blocked" in check ? { request: null, note: null } : check;
  const hasThread = reviewThreadOf(review) !== null;
  const canAsk = hasThread && !isBlank(draft) && sending === null;
  const canComment = request !== null && !isBlank(draft) && sending === null;
  const problems = problemsOf("blocked" in check ? check.blocked : null, failure, draft);

  const run = (action: Action, send: () => Promise<BoxOutcome>) => {
    if (latch.current) return;
    latch.current = true;
    setSending(action);
    setFailure(null);
    const text = draft;
    void send()
      .then(
        life.bind((outcome: BoxOutcome) => {
          setSending(null);
          onSettled(outcome, text, group.current!.contains(document.activeElement));
        }),
        life.bind((error: unknown) => {
          setSending(null);
          setFailure({ action, message: RpcCallError.from(error).message, draft: text });
        }),
      )
      .finally(() => (latch.current = false));
  };
  const ask = () => {
    if (!canAsk) return;
    const target = { projectId: head.projectId, number: head.number };
    // A box a finding's button opened, still on its line, asks about the finding, so the thread knows which.
    run("ask", async () => {
      if (box.finding === null) await askLines.mutate({ ...target, quote: quoteOf(span), question: draft });
      else await askFinding.mutate({ ...target, headSha: head.headSha, findingIndex: box.finding, question: draft });
      return { kind: "asked" };
    });
  };
  const comment = () => {
    if (!canComment) return;
    run("comment", async () => {
      const { url } = await post.mutate({ projectId: head.projectId, number: head.number, request });
      return { kind: "commented", url, body: request.body };
    });
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
      comment();
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
    <div ref={group} role="group" aria-label="Comment box" onKeyDown={onKeyDown} className={`${BOX_CLASS} transition-[border-color] duration-150 ease-out focus-within:border-[color-mix(in_oklch,var(--ring)_22%,var(--border))] motion-reduce:transition-none`}>
      <div className="flex items-center pt-2 pr-2 pl-2.5">
        <WriteTabs tabs={tabs} onWrite={() => textarea.current!.focus()} />
        <div className="ml-auto">
          <IconButton icon="X" label="Discard" size="dismiss" onClick={onClose} />
        </div>
      </div>
      <div hidden={tabs.tab !== "write"} {...tabs.panelProps("write")}>
        <label htmlFor={ids.text} className="sr-only">
          Comment or question about {span.rows.length === 1 ? "this line" : "these lines"}
        </label>
        <textarea
          ref={textarea}
          id={ids.text}
          rows={3}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="Ask about these lines, or leave a comment"
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
      {note !== null && <p className="px-[18px] pt-1 text-xs text-muted-foreground">{note}</p>}
      {sent !== null && <SentNote outcome={sent} />}
      <div className="flex min-h-11 items-center gap-1.5 pt-1.5 pr-2 pb-2 pl-[18px]">
        {problems.length > 0 ? (
          <div id={ids.error} role="alert" className="mr-auto grid min-w-0 gap-1">
            {problems.map((problem) => (
              <p key={problem} className="flex items-start gap-1.5 text-xs text-destructive-text">
                <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>{problem}</span>
              </p>
            ))}
          </div>
        ) : (
          !hasThread && (
            <p id={ids.noThread} className="mr-auto text-xs text-subtle-foreground">
              Start a review first
            </p>
          )
        )}
        <div className="ml-auto flex shrink-0 gap-1">
          {/* why aria-disabled, not disabled: the buttons stay focusable, and Ask's reason is read with it. */}
          <Button variant="ghost" size="small" aria-disabled={!canAsk} aria-describedby={hasThread || problems.length > 0 ? undefined : ids.noThread} onClick={ask}>
            {sending === "ask" ? "Sending…" : "Ask about this"}
          </Button>
          <Tooltip content={`Comment on GitHub (${COMMENT_KEYS})`} placement="top-end">
            {(describedBy) => (
              <Button variant="primary" size="small" aria-disabled={!canComment} aria-describedby={describedBy} onClick={comment}>
                <Icon name="GithubLogo" className="size-3.5" aria-hidden />
                {sending === "comment" ? "Commenting…" : "Comment"}
              </Button>
            )}
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/** Write and Preview share type, padding and minimum height, so switching moves nothing. */
const TEXT_CLASS = "block w-full min-h-[76px] px-[18px] pt-2 pb-1 text-[13px] leading-[22px] text-foreground outline-none";

/**
 * The textarea's focus, height and selection. It takes focus with the caret at the end when the
 * box opens, grows with its text to its max height and then scrolls, and `select` places the
 * selection once the text a shortcut changed is drawn. `shown`: the Write tab is selected; a
 * hidden textarea has no height to measure.
 */
function useTextarea(textarea: RefObject<HTMLTextAreaElement | null>, text: string, shown: boolean) {
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
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    drawn.observe(field);
    return () => drawn.disconnect();
  }, [textarea]);
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
