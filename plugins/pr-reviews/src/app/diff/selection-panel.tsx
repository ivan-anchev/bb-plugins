// What sits under the selected lines: a row naming them with what can be done with them (ask the
// review thread, comment on GitHub), and the box an action opened. The row stays while its box is
// open, so focus can come back to the button.
import { useId, useRef, useState, type Ref } from "react";
import { reviewThreadOf } from "../../contract.ts";
import { linesLabel, quoteOf, type LineSpan } from "../../comments/line-span.ts";
import { CommentComposer } from "../comments/comment-composer.tsx";
import { useLifetime } from "../lifetime.ts";
import { useAskAboutLines, usePullRequest, type PrHeadTarget } from "../queries.ts";
import { useOpenReviewChat } from "../review-chat/review-chat-button.tsx";
import { Button } from "../ui/button.tsx";
import { DraftBox } from "../ui/draft-box.tsx";
import type { LineBox, LinePanel } from "./line-selection.ts";

type SelectionPanelProps = {
  span: LineSpan;
  head: PrHeadTarget;
  panel: LinePanel;
  onOpenBox(box: LineBox): void;
  /** Close the box and keep the lines selected. */
  onCloseBox(): void;
  /** The question went to the review thread: clear the selection and say where it went. */
  onSent(): void;
  /** The lines are dealt with: clear the selection. */
  onDone(): void;
};

export function SelectionPanel({ span, head, panel, onOpenBox, onCloseBox, onSent, onDone }: SelectionPanelProps) {
  const { start, end } = quoteOf(span);
  const hasThread = useHasReviewThread(head);
  const toggles = { ask: useRef<HTMLButtonElement>(null), comment: useRef<HTMLButtonElement>(null) };
  const box = useRef<HTMLDivElement>(null);
  const boxId = useId();
  const reasonId = useId();
  const open = panel === "actions" ? null : panel;

  // Focus comes back to the box's button only from inside the closing box, never from elsewhere on the page.
  const closeBox = () => {
    if (open !== null && box.current?.contains(document.activeElement)) toggles[open].current?.focus();
    onCloseBox();
  };
  const toggle = (which: LineBox) => (open === which ? closeBox() : onOpenBox(which));
  const toggleProps = (which: LineBox) => ({ ref: toggles[which], "aria-expanded": open === which, "aria-controls": open === which ? boxId : undefined });

  return (
    <div className="px-2 pt-1 pb-1.5">
      <section aria-label="Selected lines" className="grid gap-1 rounded-md bg-muted px-2.5 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">{linesLabel(start, end)}</span>
          {/* why aria-disabled, not disabled: the button stays focusable, and its reason is read with it. */}
          <Button
            {...toggleProps("ask")}
            variant="secondary"
            size="small"
            aria-disabled={!hasThread}
            aria-describedby={hasThread ? undefined : reasonId}
            onClick={hasThread ? () => toggle("ask") : undefined}
          >
            Ask the review thread
          </Button>
          {!hasThread && (
            <span id={reasonId} className="text-subtle-foreground">
              Start a review first
            </span>
          )}
          <Button {...toggleProps("comment")} variant="secondary" size="small" onClick={() => toggle("comment")}>
            Comment on GitHub
          </Button>
          {open === null && <span className="ml-auto text-subtle-foreground">Esc clears</span>}
        </div>
        {open === "ask" && <AskAboutLines id={boxId} ref={box} span={span} head={head} onClose={closeBox} onSent={onSent} />}
        {open === "comment" && (
          <div id={boxId} ref={box}>
            <CommentComposer span={span} head={head} initialText="" startAt="write" onCancel={closeBox} onDone={onDone} />
          </div>
        )}
      </section>
    </div>
  );
}

// The page's own read of the PR (one shared cache entry) says whether it has a review thread.
function useHasReviewThread(head: PrHeadTarget): boolean {
  const pull = usePullRequest(head.projectId, head.number);
  return pull.data !== undefined && reviewThreadOf(pull.data.review) !== null;
}

type AskAboutLinesProps = {
  id: string;
  ref: Ref<HTMLDivElement>;
  span: LineSpan;
  head: PrHeadTarget;
  onClose(): void;
  onSent(): void;
};

// Send queues the question behind whatever the thread is doing, then shows Review chat, where the
// answer arrives. A failure stays beside the kept question. A send that lands after this box has
// gone (Cancel, another file, another page) changes nothing: the lines, or a newer box under
// them, are no longer this box's.
function AskAboutLines({ id, ref, span, head, onClose, onSent }: AskAboutLinesProps) {
  const ask = useAskAboutLines();
  const openReviewChat = useOpenReviewChat();
  const life = useLifetime();
  const [question, setQuestion] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const send = () =>
    ask
      .mutate({ projectId: head.projectId, number: head.number, quote: quoteOf(span), question })
      .then(
        life.bind(() => {
          openReviewChat();
          onSent();
        }),
      )
      .catch(() => undefined);
  return (
    <DraftBox
      id={id}
      ref={ref}
      textareaRef={textarea}
      label="Question for the review thread"
      placeholder="Ask the review thread about these lines…"
      value={question}
      onChange={setQuestion}
      onEscapeEmpty={onClose}
      onCancel={onClose}
      error={ask.error?.message ?? null}
      action={{ label: "Send", pending: ask.isPending, run: send }}
    />
  );
}
