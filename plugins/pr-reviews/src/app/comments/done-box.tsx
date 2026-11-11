// The comment box once it has done its job, in the same shell so the result lands where the text
// was: word that the comment posted, with its link (the comment itself shows in its thread), that
// it is in the reader's pending review (where it shows as pending), or that the question went to
// the review thread.
// And the same word in a box still being written, for a request that went while the reader
// changed its text.
import { useEffect, useRef } from "react";
import { experimental_Icon as Icon, UrlLink } from "@get-bb/plugin-sdk/app";
import type { BoxOutcome } from "../diff/line-selection.ts";
import { useOpenReviewChat } from "../review-chat/review-chat-button.tsx";
import { Button, buttonClass } from "../ui/button.tsx";

/**
 * The box's shell, writing or done: one ring in every state, focused or not, as bb's composer has
 * (app.css). Its corners are 12px, or what a surface it sits in sets in `--pr-reviews-box-radius`.
 */
export const BOX_CLASS = "rounded-[var(--pr-reviews-box-radius,12px)] border border-(--pr-reviews-box-ring) bg-background shadow-[0_1px_2px_rgb(0_0_0/.04),0_6px_16px_-8px_rgb(0_0_0/.14)]";

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
      <div className="flex min-h-9 flex-wrap items-center gap-2 pt-2 pr-2 pb-2 pl-[18px]">
        <p role="status" className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Icon name="Check" className="size-3.5 text-success-foreground" aria-hidden />
          {DONE_WORDS[outcome.kind]}
        </p>
        <div className="ml-auto flex gap-1">
          <DoneLink outcome={outcome} openReviewChat={openReviewChat} />
          <Button ref={done} variant="ghost" size="small" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

const DONE_WORDS = {
  commented: "Commented",
  asked: "Sent to the review thread",
  reviewed: "Added to your review",
} as const satisfies Record<BoxOutcome["kind"], string>;

// Where the outcome is: the comment on GitHub, or the answer in Review chat. A pending comment is
// in its thread, marked pending, and goes to GitHub when the review is submitted.
function DoneLink({ outcome, openReviewChat }: { outcome: BoxOutcome; openReviewChat(): void }) {
  switch (outcome.kind) {
    case "commented":
      return (
        <UrlLink href={outcome.url} className={buttonClass("ghost", "small")}>
          View on GitHub
          <Icon name="ArrowUpRight" className="size-3.5" aria-hidden />
        </UrlLink>
      );
    case "asked":
      return (
        <Button variant="ghost" size="small" onClick={openReviewChat}>
          <Icon name="SideChat" className="size-3.5" aria-hidden />
          Open Review chat
        </Button>
      );
    case "reviewed":
      return null;
    default:
      return outcome satisfies never;
  }
}

/** In a box still being written: a request went with the text as it was, and the text has changed since. */
export function SentNote({ outcome }: { outcome: BoxOutcome }) {
  const openReviewChat = useOpenReviewChat();
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-1.5 px-[18px] pt-1 text-xs text-muted-foreground">
      <Icon name="Check" className="size-3.5 text-success-foreground" aria-hidden />
      <SentWords outcome={outcome} openReviewChat={openReviewChat} />
    </p>
  );
}

function SentWords({ outcome, openReviewChat }: { outcome: BoxOutcome; openReviewChat(): void }) {
  switch (outcome.kind) {
    case "commented":
      return (
        <>
          Commented with your earlier text.
          <UrlLink href={outcome.url} className={`${LINK_CLASS} inline-flex items-center gap-0.5`}>
            View on GitHub
            <Icon name="ArrowUpRight" className="size-3" aria-hidden />
          </UrlLink>
        </>
      );
    case "asked":
      return (
        <>
          Sent your earlier text to the review thread.
          <button type="button" className={LINK_CLASS} onClick={openReviewChat}>
            Open Review chat
          </button>
        </>
      );
    case "reviewed":
      return <>Added your earlier text to your review.</>;
    default:
      return outcome satisfies never;
  }
}

const LINK_CLASS = "cursor-pointer rounded-sm font-medium text-foreground decoration-foreground/35 underline-offset-[3px] hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";
