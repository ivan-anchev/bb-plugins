import type { ReactNode } from "react";
import { foldPlan, type PlanStep, type PlanView, type StepState } from "../../card/plan-fold.ts";
import type { PlanRead } from "../../data/use-plan.ts";
import { StateGlyph } from "../state-glyph.tsx";
import { CardGlyph } from "./card-glyphs.tsx";

type Props = { read: PlanRead; open: boolean; onUnfold(): void };

export function PlanSection({ read, open, onUnfold }: Props) {
  const plan = read.todos === null ? null : foldPlan(read.todos, open);
  if (plan === null && !read.failed) return null;
  return <Plan plan={plan} failed={read.failed} onRetry={read.retry} onUnfold={onUnfold} />;
}

type PlanProps = { plan: PlanView | null; failed: boolean; onRetry(): void; onUnfold(): void };

function Plan({ plan, failed, onRetry, onUnfold }: PlanProps) {
  return (
    <>
      <div className="as-card-rule" />
      <div className="as-card-plan">
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

function Fold({ count, later, onOpen }: { count: number; later: boolean; onOpen(): void }) {
  const which = later ? "later" : "earlier";
  return (
    <button type="button" className="as-card-fold" aria-label={`Show ${count} ${which} steps`} onClick={onOpen}>
      {count} {which}
    </button>
  );
}
