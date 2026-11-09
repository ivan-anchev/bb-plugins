// What sits under the selected lines: a row naming them with what can be done with them, and the
// box an action opened. The row stays while its box is open, so focus can come back to the button.
import { useId, useRef, useState, type Ref } from "react";
import { reviewThreadOf } from "../../contract.ts";
import { linesLabel, quoteOf, type LineSpan } from "../../comments/line-span.ts";
import { useLifetime } from "../lifetime.ts";
import { useAskAboutLines, usePullRequest, type PrHeadTarget } from "../queries.ts";
import { useOpenReviewChat } from "../review-chat/review-chat-button.tsx";
import { Button } from "../ui/button.tsx";
import { DraftBox } from "../ui/draft-box.tsx";
import type { LinePanel } from "./line-selection.ts";

type SelectionPanelProps = {
  span: LineSpan;
  head: PrHeadTarget;
  panel: LinePanel;
  onAsk(): void;
  /** Close the box and keep the lines selected. */
  onCloseBox(): void;
  /** The lines are dealt with: clear the selection. */
  onDone(): void;
};

export function SelectionPanel({ span, head, panel, onAsk, onCloseBox, onDone }: SelectionPanelProps) {
  const { start, end } = quoteOf(span);
  const hasThread = useHasReviewThread(head);
  const askButton = useRef<HTMLButtonElement>(null);
  const askBox = useRef<HTMLDivElement>(null);
  const askId = useId();
  const reasonId = useId();
  const askOpen = panel === "ask";

  // Focus comes back to the button only from inside the closing box, never from elsewhere on the page.
  const closeAsk = () => {
    if (askBox.current?.contains(document.activeElement)) askButton.current?.focus();
    onCloseBox();
  };

  return (
    <div className="px-2 pt-1 pb-1.5">
      <section aria-label="Selected lines" className="grid gap-1 rounded-md bg-muted px-2.5 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">{linesLabel(start, end)}</span>
          {/* why aria-disabled, not disabled: the button stays focusable, and its reason is read with it. */}
          <Button
            ref={askButton}
            variant="secondary"
            size="small"
            aria-expanded={askOpen}
            aria-controls={askOpen ? askId : undefined}
            aria-disabled={!hasThread}
            aria-describedby={hasThread ? undefined : reasonId}
            onClick={hasThread ? () => (askOpen ? closeAsk() : onAsk()) : undefined}
          >
            Ask the review thread
          </Button>
          {!hasThread && (
            <span id={reasonId} className="text-subtle-foreground">
              Start a review first
            </span>
          )}
          {!askOpen && <span className="ml-auto text-subtle-foreground">Esc clears</span>}
        </div>
        {askOpen && <AskAboutLines id={askId} ref={askBox} span={span} head={head} onClose={closeAsk} onSent={onDone} />}
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
