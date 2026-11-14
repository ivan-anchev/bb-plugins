// The card's plan (P:1259-1289): "Todo 3/9", then its steps, done a check, the one in progress the
// working ring, pending a quiet point; folded past six to "N earlier", three steps, "N later". Either
// button opens the whole plan for as long as the card stays open (Z:ds/composer_dock.luau:1647, 1735-1741).
// A read that failed says so above the plan it leaves in place, with Retry.
import { useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from "react";
import { foldPlan, type PlanStep, type PlanView, type StepState } from "../../card/plan-fold.ts";
import type { PlanRead } from "../../data/use-plan.ts";
import { StateGlyph } from "../state-glyph.tsx";
import { CardGlyph } from "./card-glyphs.tsx";

export function PlanSection({ read }: { read: PlanRead }) {
  const [open, setOpen] = useState(false);
  const plan = read.todos === null ? null : foldPlan(read.todos, open);
  // why: a failed read shows even with no plan read yet: bb's plan is unknown then, not absent.
  if (plan === null && !read.failed) return null;
  return <Plan plan={plan} failed={read.failed} onRetry={read.retry} onUnfold={() => setOpen(true)} />;
}

// ------------------------------------------------------------------ layer 2

type PlanProps = { plan: PlanView | null; failed: boolean; onRetry(): void; onUnfold(): void };

function Plan({ plan, failed, onRetry, onUnfold }: PlanProps) {
  const kept = useFocusKept();
  return (
    <>
      <div className="as-card-rule" />
      <div {...kept} className="as-card-plan" tabIndex={-1}>
        <div className="as-card-sub-head">
          <span className="as-card-g">
            <CardGlyph name="checklist" />
          </span>
          Todo
          {plan !== null && (
            <span>
              {plan.done}/{plan.total}
            </span>
          )}
        </div>
        {failed && <ReadFailed stale={plan !== null} onRetry={onRetry} />}
        {plan !== null && (
          <>
            {plan.earlier > 0 && <Fold count={plan.earlier} later={false} onOpen={onUnfold} />}
            {plan.steps.map((step) => (
              <Step key={step.id} step={step} />
            ))}
            {plan.later > 0 && <Fold count={plan.later} later onOpen={onUnfold} />}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Focus in the plan stays in the card when an update takes the control it is on: the fold pressed, a
 * fold the agent's next step makes needless, a Retry that worked. The plan takes it while it shows, the
 * card once the plan goes. Focus that left the plan is never moved.
 */
function useFocusKept(): { ref: RefObject<HTMLDivElement | null>; onFocus(e: FocusEvent): void; onBlur(e: FocusEvent): void } {
  const ref = useRef<HTMLDivElement>(null);
  /** What has focus in the plan; null while focus is elsewhere. */
  const holder = useRef<Element | null>(null);
  // why: React hears no blur while it commits, so a holder gone from the page is one an update took.
  // Focus merely moving on (the page has no focus for that instant) leaves the holder in place.
  useLayoutEffect(() => {
    if (holder.current !== null && !holder.current.isConnected) ref.current?.focus();
  });
  useLayoutEffect(() => {
    const card = ref.current?.closest<HTMLElement>(".as-card");
    return () => {
      if (holder.current !== null) card?.focus();
    };
  }, []);
  return {
    ref,
    onFocus: (e) => {
      holder.current = e.target;
    },
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) holder.current = null;
    },
  };
}

/** Over a plan shown, it may be out of date; with none, whether there is one is unknown. */
function ReadFailed({ stale, onRetry }: { stale: boolean; onRetry(): void }) {
  return (
    <div className="as-card-failed" role="status">
      {stale ? "Couldn't update the plan" : "Couldn't load the plan"}
      <span aria-hidden>·</span>
      <button type="button" className="as-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function Step({ step }: { step: PlanStep }) {
  return (
    <div className="as-card-step" data-state={step.state}>
      <span className="as-card-g">{stepGlyph(step.state)}</span>
      <span className="as-card-step-t">{step.text}</span>
    </div>
  );
}

function stepGlyph(state: StepState): ReactNode {
  switch (state) {
    case "done":
      return <StateGlyph state="done" size={12} />;
    case "doing":
      return <StateGlyph state="working" size={12} />;
    case "pending":
      return <i className="as-card-point" />;
    default:
      state satisfies never;
      return null;
  }
}

/** "2 earlier" / "4 later" (Z:ds/locale_en.luau:657-658). */
function Fold({ count, later, onOpen }: { count: number; later: boolean; onOpen(): void }) {
  const which = later ? "later" : "earlier";
  return (
    <button type="button" className="as-card-fold" aria-label={`Show ${count} ${which} steps`} onClick={onOpen}>
      {count} {which}
    </button>
  );
}
