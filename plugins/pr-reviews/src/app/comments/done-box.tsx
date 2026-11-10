// The comment box once it has done its job, in the same shell so the result lands where the text
// was: the posted comment with its link, or word that the question went to the review thread.
// And the same word in a box still being written, for a request that went while the reader
// changed its text.
import { useEffect, useRef } from "react";
import { experimental_Icon as Icon, UrlLink } from "@get-bb/plugin-sdk/app";
import type { BoxOutcome } from "../diff/line-selection.ts";
import { useOpenReviewChat } from "../review-chat/review-chat-button.tsx";
import { Button, buttonClass } from "../ui/button.tsx";
import { Prose } from "../ui/prose.tsx";

/** The box's shell, writing or done. */
export const BOX_CLASS = "rounded-xl border border-border bg-background shadow-[0_1px_2px_rgb(0_0_0/.04),0_6px_16px_-8px_rgb(0_0_0/.14)]";

/** `takeFocus`: the composer this replaces had focus, which would otherwise drop to the page body. */
type DoneBoxProps = { outcome: BoxOutcome; takeFocus: boolean; onDone(): void };

// Done takes the focus the composer had (REVIEW.md). Esc anywhere in the box is Done too: a done
// box holds no draft, since the text that went was all of it.
export function DoneBox({ outcome, takeFocus, onDone }: DoneBoxProps) {
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (takeFocus) done.current!.focus();
  }, [takeFocus]);
  const openReviewChat = useOpenReviewChat();
  return (
    <div
      role="group"
      aria-label="Comment box"
      className={BOX_CLASS}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDone();
      }}
    >
      <div className={`flex min-h-9 flex-wrap items-center gap-2 pt-2 pr-2 pl-[18px] ${outcome.kind === "asked" ? "pb-2" : ""}`}>
        <p role="status" className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Icon name="Check" className="size-3.5 text-success-foreground" aria-hidden />
          {outcome.kind === "commented" ? "Commented" : "Sent to the review thread"}
        </p>
        <div className="ml-auto flex gap-1">
          {outcome.kind === "commented" ? (
            <UrlLink href={outcome.url} className={buttonClass("ghost", "small")}>
              View on GitHub
              <Icon name="ArrowUpRight" className="size-3.5" aria-hidden />
            </UrlLink>
          ) : (
            <Button variant="ghost" size="small" onClick={openReviewChat}>
              <Icon name="SideChat" className="size-3.5" aria-hidden />
              Open Review chat
            </Button>
          )}
          <Button ref={done} variant="ghost" size="small" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
      {outcome.kind === "commented" && (
        <div className="px-[18px] pt-1.5 pb-3.5 text-[13px] leading-[22px] text-foreground">
          <Prose text={outcome.body} />
        </div>
      )}
    </div>
  );
}

/** In a box still being written: a request went with the text as it was, and the text has changed since. */
export function SentNote({ outcome }: { outcome: BoxOutcome }) {
  const openReviewChat = useOpenReviewChat();
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-1.5 px-[18px] pt-1 text-xs text-muted-foreground">
      <Icon name="Check" className="size-3.5 text-success-foreground" aria-hidden />
      {outcome.kind === "commented" ? (
        <>
          Commented with your earlier text.
          <UrlLink href={outcome.url} className={`${LINK_CLASS} inline-flex items-center gap-0.5`}>
            View on GitHub
            <Icon name="ArrowUpRight" className="size-3" aria-hidden />
          </UrlLink>
        </>
      ) : (
        <>
          Sent your earlier text to the review thread.
          <button type="button" className={LINK_CLASS} onClick={openReviewChat}>
            Open Review chat
          </button>
        </>
      )}
    </p>
  );
}

const LINK_CLASS = "cursor-pointer rounded-sm font-medium text-foreground decoration-foreground/35 underline-offset-[3px] hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";
