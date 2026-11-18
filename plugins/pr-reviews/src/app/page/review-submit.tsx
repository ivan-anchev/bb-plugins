// Review: the header's control, on every tab, for submitting the reader's review of the PR. With
// a pending review on GitHub it is Finish review, counting the review's pending comments, and its
// popover submits the review or discards it. With none, a reader who didn't write the PR can
// still review it at once, with no comments; its author comments on the conversation instead. The
// popover submits as a comment, an approval or a request for changes (only a comment on the
// reader's own PR), with a body, optional unless GitHub needs one. A GitHub refusal shows in the
// popover beside the body, which stays. Once GitHub has the review the control says so: until
// the comments read no longer has it pending, or a moment for a review that never was.
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { experimental_Icon as Icon, experimental_PluginRpcCallError as RpcCallError } from "@get-bb/plugin-sdk/app";
import { GITHUB_BODY_LIMIT } from "../../comments/comment-schema.ts";
import type { ReviewEvent } from "../../comments/review-schema.ts";
import { PENDING_TONE } from "../comments/github-comment.tsx";
import { isBlank } from "../diff/line-selection.ts";
import { useLifetime } from "../lifetime.ts";
import { useComments, useDiscardReview, useSubmitReview, type PrTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { bodyRequired, reviewEventsFor } from "./review-events.ts";

/** `focusAfter`: where focus goes when the control leaves while holding it, as it does once the review is in. */
type ReviewSubmitProps = { target: PrTarget; focusAfter: RefObject<HTMLElement | null> };

/** A review GitHub has taken: the pending review submitted or discarded, or a new one (null) submitted. */
type Done = { reviewId: string | null; outcome: "submitted" | "discarded" };

/** How long the word that a new review went stays, with no pending review for the read to drop. */
const NEW_REVIEW_DONE_MS = 2500;

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
  useEffect(() => {
    if (done?.reviewId !== null) return;
    const timer = setTimeout(() => setDone(null), NEW_REVIEW_DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);
  const read = comments.data;
  if (read === undefined) return null;
  const { pendingReviewId, author } = read.viewer;
  if (pendingReviewId === null && author) return null;
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
      <SubmitPopover key={pendingReviewId} target={target} reviewId={pendingReviewId} author={author} pending={pending} panel={panel} onDone={onDone} />
    </div>
  );
}

/** `panel`: takes the open popover's panel. */
type SubmitPopoverProps = { target: PrTarget; reviewId: string | null; author: boolean; pending: number; panel: RefObject<HTMLDivElement | null>; onDone(outcome: Done["outcome"]): void };

// The body, the chosen event and a failure stay while the popover closes and opens again; a new
// pending review, or none after a new review went, is a new popover (keyed, or drawn again). A
// reply that lands after the control has gone changes nothing.
function SubmitPopover({ target, reviewId, author, pending, panel, onDone }: SubmitPopoverProps) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = useSubmitReview();
  const discard = useDiscardReview();
  const life = useLifetime();
  // A body outlives the popover, which a click outside closes: Esc then must not leave the PR with it.
  useHoldEscape(!isBlank(body));
  const ids = { body: useId(), error: useId() };
  // Focus stays on the footer's buttons as Discard review turns into its confirmation and back.
  const toConfirm = useFocusHandOff();
  const toAsk = useFocusHandOff();
  const sending = submit.isPending || discard.isPending;
  const tooLong = body.length > GITHUB_BODY_LIMIT;
  const finishing = reviewId !== null;
  const required = bodyRequired(event, finishing);
  const needsBody = required && isBlank(body);
  const events = reviewEventsFor(author);
  const title = finishing ? "Finish your review" : "Review this pull request";
  const bodyName = finishing ? "summary" : "comment";

  const run = (write: () => Promise<unknown>, outcome: Done["outcome"]) => {
    if (sending) return;
    setFailure(null);
    void write().then(
      life.bind(() => onDone(outcome)),
      life.bind((error: unknown) => setFailure(RpcCallError.from(error).message)),
    );
  };
  const onSubmit = () => {
    if (tooLong || needsBody) return;
    run(() => submit.mutate({ ...target, reviewId, event, body: body.trim() }), "submitted");
  };
  const onDiscard = (reviewId: string) => run(() => discard.mutate({ ...target, reviewId }), "discarded");
  const submitButton = (
    <Button variant="default" size="sm" aria-disabled={sending || tooLong || needsBody} onClick={onSubmit}>
      {submit.isPending ? "Submitting…" : "Submit review"}
    </Button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConfirmingDiscard(false);
      }}
    >
      <PopoverTrigger asChild>
        {reviewId === null ? (
          <Button variant="secondary" size="sm">
            Review
          </Button>
        ) : (
          <Button variant="secondary" size="sm" aria-label={`Finish review, ${pending} pending ${pending === 1 ? "comment" : "comments"}`}>
            Finish review
            {pending > 0 && <span className={`min-w-4 rounded-full px-1 text-center text-[11px] leading-4 tabular-nums ${PENDING_TONE}`}>{pending}</span>}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent label={title} width="w-[22rem]">
        <div
          ref={panel}
          className="grid gap-2.5 p-1"
          onKeyDown={(keyEvent) => {
            if (keyEvent.key !== "Enter" || !(keyEvent.metaKey || keyEvent.ctrlKey)) return;
            keyEvent.preventDefault();
            // The shortcut is Submit review's, so it does nothing while the discard confirmation hides that button.
            if (!confirmingDiscard) onSubmit();
          }}
        >
          <p className="text-[13px] font-semibold">{title}</p>
          <label htmlFor={ids.body} className="sr-only">
            {finishing ? "Summary" : "Comment"}
          </label>
          <textarea
            id={ids.body}
            rows={3}
            value={body}
            onChange={(change) => setBody(change.target.value)}
            placeholder={placeholderOf(finishing, required)}
            aria-describedby={failure === null ? undefined : ids.error}
            className="block max-h-48 min-h-[78px] w-full resize-y rounded-md bg-background px-2.5 py-2 text-[13px] leading-5 text-foreground inset-ring inset-ring-input outline-none placeholder:text-subtle-foreground focus-visible:inset-ring-ring"
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
            <p id={ids.error} role="alert" className={`flex items-start gap-1.5 text-xs text-destructive-text`}>
              <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{tooLong ? `The ${bodyName} is ${body.length.toLocaleString("en")} characters, and GitHub takes at most ${GITHUB_BODY_LIMIT.toLocaleString("en")}.` : failure}</span>
            </p>
          )}
          {/* why Discard on the left, away from Submit: the two must never be one slip apart. Keyed:
              each footer is its own element, so React lets go of one, focus still in it, before
              it removes it (focus-hand-off.ts). A new review has nothing to discard. */}
          {reviewId === null ? (
            <div className="flex justify-end">{submitButton}</div>
          ) : confirmingDiscard ? (
            <div key="confirm" ref={toAsk.from} className="flex items-center gap-1.5">
              <p className="mr-auto text-xs text-foreground">{discardQuestion(pending)}</p>
              <Button ref={toConfirm.to} variant="ghost" size="sm" onClick={() => setConfirmingDiscard(false)}>
                Keep
              </Button>
              <Button variant="destructive" size="sm" aria-disabled={sending} onClick={() => onDiscard(reviewId)}>
                {discard.isPending ? "Discarding…" : "Discard"}
              </Button>
            </div>
          ) : (
            <div key="ask" ref={toConfirm.from} className="flex items-center justify-between gap-1.5">
              <Button ref={toAsk.to} variant="ghost" size="sm" aria-disabled={sending} onClick={() => setConfirmingDiscard(true)}>
                Discard review
              </Button>
              {submitButton}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// A pending review's body sums up its comments; a new review's is the review.
function placeholderOf(finishing: boolean, required: boolean): string {
  if (finishing) return "Leave a summary (optional)";
  return required ? "Leave a comment" : "Leave a comment (optional)";
}

// A review can be pending with no comments, as one started for a comment GitHub couldn't place.
function discardQuestion(pending: number): string {
  if (pending === 0) return "Discard your pending review?";
  return pending === 1 ? "Discard your pending comment?" : `Discard all ${pending} pending comments?`;
}
