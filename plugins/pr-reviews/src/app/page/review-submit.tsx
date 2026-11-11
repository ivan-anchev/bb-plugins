// Finish review: the header's control while the reader has a pending review on GitHub, on every
// tab. It counts the review's pending comments, and opens a popover to submit the review as a
// comment, an approval or a request for changes (only a comment on the reader's own PR), with an
// optional summary, or to discard it. A GitHub refusal shows in the popover beside the summary, which stays. Once GitHub has the review,
// the control says so until the comments read no longer has it pending, then goes.
import { useCallback, useId, useRef, useState, type RefObject } from "react";
import { experimental_Icon as Icon, experimental_PluginRpcCallError as RpcCallError } from "@get-bb/plugin-sdk/app";
import { GITHUB_BODY_LIMIT } from "../../comments/comment-schema.ts";
import type { ReviewEvent } from "../../comments/review-schema.ts";
import { PENDING_TONE } from "../comments/github-comment.tsx";
import { isBlank } from "../diff/line-selection.ts";
import { useLifetime } from "../lifetime.ts";
import { useComments, useDiscardReview, useSubmitReview, type PrTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";
import { DESTRUCTIVE_TEXT_ON_MUTED } from "../ui/destructive-text-on-muted.ts";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { reviewEventsFor } from "./review-events.ts";

/** `focusAfter`: where focus goes when the control leaves while holding it, as it does once the review is in. */
type ReviewSubmitProps = { target: PrTarget; focusAfter: RefObject<HTMLElement | null> };

/** A review GitHub has taken: submitted, or discarded. */
type Done = { reviewId: string; outcome: "submitted" | "discarded" };

export function ReviewSubmit({ target, focusAfter }: ReviewSubmitProps) {
  const comments = useComments(target);
  const [done, setDone] = useState<Done | null>(null);
  // The open popover's panel, portaled outside the control, so outside `control` below.
  const panel = useRef<HTMLDivElement>(null);
  // why a ref callback: React runs its cleanup before it removes the control, while focus is still
  // in it, and before it detaches the panel inside it, which goes with it. The title is gone
  // already when the whole page leaves, and focus with it.
  const handOff = useCallback(
    (control: HTMLElement | null) => {
      if (control === null) return;
      return () => {
        const focused = document.activeElement;
        if (control.contains(focused) || panel.current?.contains(focused)) focusAfter.current?.focus();
      };
    },
    [focusAfter],
  );
  const read = comments.data;
  const pendingReviewId = read?.viewer.pendingReviewId ?? null;
  if (read === undefined || pendingReviewId === null) return null;
  // The read still has the review GitHub took: say so until the next read drops it.
  if (done?.reviewId === pendingReviewId) {
    return (
      <p role="status" className="flex h-7 items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
        <Icon name="Check" className="size-3.5 text-success-foreground" aria-hidden />
        {done.outcome === "submitted" ? "Review submitted" : "Review discarded"}
      </p>
    );
  }
  const pending = read.threads.flatMap((thread) => thread.comments).filter((comment) => comment.pending).length;
  const onDone = (outcome: Done["outcome"]) => {
    focusAfter.current!.focus();
    setDone({ reviewId: pendingReviewId, outcome });
  };
  return (
    <div ref={handOff}>
      <SubmitPopover key={pendingReviewId} target={target} reviewId={pendingReviewId} author={read.viewer.author} pending={pending} panel={panel} onDone={onDone} />
    </div>
  );
}

/** `panel`: takes the open popover's panel. */
type SubmitPopoverProps = { target: PrTarget; reviewId: string; author: boolean; pending: number; panel: RefObject<HTMLDivElement | null>; onDone(outcome: Done["outcome"]): void };

// The summary, the chosen event and a failure stay while the popover closes and opens again; a new
// pending review is a new popover (keyed). A reply that lands after the control has gone changes
// nothing.
function SubmitPopover({ target, reviewId, author, pending, panel, onDone }: SubmitPopoverProps) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = useSubmitReview();
  const discard = useDiscardReview();
  const life = useLifetime();
  // A summary outlives the popover, which a click outside closes: Esc then must not leave the PR with it.
  useHoldEscape(!isBlank(body));
  const ids = { body: useId(), error: useId() };
  // Focus stays on the footer's buttons as Discard review turns into its confirmation and back.
  const toConfirm = useFocusHandOff();
  const toAsk = useFocusHandOff();
  const sending = submit.isPending || discard.isPending;
  const tooLong = body.length > GITHUB_BODY_LIMIT;
  const events = reviewEventsFor(author);

  const run = (write: () => Promise<unknown>, outcome: Done["outcome"]) => {
    if (sending) return;
    setFailure(null);
    void write().then(
      life.bind(() => onDone(outcome)),
      life.bind((error: unknown) => setFailure(RpcCallError.from(error).message)),
    );
  };
  const onSubmit = () => {
    if (tooLong) return;
    run(() => submit.mutate({ ...target, reviewId, event, body: body.trim() }), "submitted");
  };
  const onDiscard = () => run(() => discard.mutate({ ...target, reviewId }), "discarded");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConfirmingDiscard(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="small" aria-label={`Finish review, ${pending} pending ${pending === 1 ? "comment" : "comments"}`}>
          Finish review
          {pending > 0 && <span className={`min-w-4 rounded-full px-1 text-center text-[11px] leading-4 tabular-nums ${PENDING_TONE}`}>{pending}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent label="Finish your review" width="w-[22rem]">
        <div
          ref={panel}
          className="grid gap-2.5 p-1"
          onKeyDown={(keyEvent) => {
            if (keyEvent.key !== "Enter" || !(keyEvent.metaKey || keyEvent.ctrlKey)) return;
            keyEvent.preventDefault();
            onSubmit();
          }}
        >
          <p className="text-[13px] font-semibold">Finish your review</p>
          <label htmlFor={ids.body} className="sr-only">
            Summary
          </label>
          <textarea
            id={ids.body}
            rows={3}
            value={body}
            onChange={(change) => setBody(change.target.value)}
            placeholder="Leave a summary (optional)"
            aria-describedby={failure === null ? undefined : ids.error}
            className="block max-h-48 min-h-[78px] w-full resize-y rounded-md bg-background px-2.5 py-2 text-[13px] leading-5 text-foreground inset-ring inset-ring-(--pr-reviews-box-ring) outline-none placeholder:text-subtle-foreground focus-visible:inset-ring-ring"
          />
          {events.length > 1 && (
            <fieldset className="grid gap-0.5">
              <legend className="sr-only">Submit as</legend>
              {events.map((option) => (
                <label
                  key={option.event}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-state-hover hover:duration-0 has-checked:bg-state-active"
                >
                  <input type="radio" name="event" value={option.event} checked={event === option.event} onChange={() => setEvent(option.event)} className="mt-[3px] accent-foreground" />
                  <span className="grid">
                    <span className="text-[13px] leading-5 font-medium">{option.label}</span>
                    <span className="text-xs leading-[18px] text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {(failure !== null || tooLong) && (
            <p id={ids.error} role="alert" className={`flex items-start gap-1.5 text-xs ${DESTRUCTIVE_TEXT_ON_MUTED}`}>
              <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{tooLong ? `The summary is ${body.length.toLocaleString("en")} characters, and GitHub takes at most ${GITHUB_BODY_LIMIT.toLocaleString("en")}.` : failure}</span>
            </p>
          )}
          {/* why Discard on the left, away from Submit: the two must never be one slip apart. Keyed:
              each footer is its own element, so React lets go of one, focus still in it, before
              it removes it (focus-hand-off.ts). */}
          {confirmingDiscard ? (
            <div key="confirm" ref={toAsk.from} className="flex items-center gap-1.5">
              <p className="mr-auto text-xs text-foreground">{discardQuestion(pending)}</p>
              <Button ref={toConfirm.to} variant="ghost" size="small" onClick={() => setConfirmingDiscard(false)}>
                Keep
              </Button>
              <Button variant="destructive" size="small" aria-disabled={sending} onClick={onDiscard}>
                {discard.isPending ? "Discarding…" : "Discard"}
              </Button>
            </div>
          ) : (
            <div key="ask" ref={toConfirm.from} className="flex items-center justify-between gap-1.5">
              <Button ref={toAsk.to} variant="ghost" size="small" aria-disabled={sending} onClick={() => setConfirmingDiscard(true)}>
                Discard review
              </Button>
              <Button variant="primary" size="small" aria-disabled={sending || tooLong} onClick={onSubmit}>
                {submit.isPending ? "Submitting…" : "Submit review"}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// A review can be pending with no comments, as one started for a comment GitHub couldn't place.
function discardQuestion(pending: number): string {
  if (pending === 0) return "Discard your pending review?";
  return pending === 1 ? "Discard your pending comment?" : `Discard all ${pending} pending comments?`;
}
