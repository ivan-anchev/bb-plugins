// One delegate: a two-line row (avatar with status dot, title over the detail
// line, elapsed time) that expands in place to its meta line, outcome, and step
// trail. Words come from roster.ts and steps.ts; the outcome notes live here.
import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type TransitionEvent } from "react";
import { experimental_Icon as Icon, Markdown } from "@get-bb/plugin-sdk/app";
import type { StepRow } from "../bb.ts";
import type { Delegate, DelegateStatus } from "../delegate.ts";
import { detailLine, elapsed, isRunning, metaParts } from "../roster.ts";
import { stepFailed, stepKind, stepLabel, trailSteps, type StepKind } from "../steps.ts";
import { formatDuration, formatOffset, useNow } from "../clock.ts";
import { Avatar } from "./Avatar.tsx";
import { RollingText } from "./Motion.tsx";
import { followTail, markOverflow, startAtTop } from "./scroll.ts";

type RowProps = { providerId: string; delegate: Delegate; expanded: boolean; onToggle: () => void };

export function DelegateRow({ providerId, delegate: d, expanded, onToggle }: RowProps) {
  const now = useNow(isRunning(d));
  const bodyId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const collapseOnEscape = (e: KeyboardEvent) => {
    if (!expanded || e.key !== "Escape") return;
    e.stopPropagation(); // the row's Esc, not the thread's
    onToggle();
    trigger.current?.focus(); // the body goes inert, so focus inside it would be lost
  };
  return (
    <li className="sr-row" data-st={d.state.status} data-open={expanded || undefined} onKeyDown={collapseOnEscape} onTransitionEnd={expanded ? keepGrownRowInView : undefined}>
      <button ref={trigger} type="button" className="sr-row-head" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
        <Avatar providerId={providerId} status={d.state.status} />
        <span className="sr-row-txt">
          <span className="sr-row-title" title={d.title}>{d.title}</span>
          <RollingText className="sr-row-detail" text={detailLine(d)} />
        </span>
        <span className="sr-el">{formatDuration(elapsed(d, now))}</span>
        <Icon name="ChevronRight" className="sr-row-chev" aria-hidden />
      </button>
      {/* why: kept mounted while collapsed so it can grow and shrink, and keeps its Show more state; inert hides it. */}
      <div className="sr-x-wrap">
        <div className="sr-x-clip">
          <div className="sr-x" id={bodyId} inert={!expanded}>
            <RowDetail delegate={d} />
          </div>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- layer 2

/** The meta line, then the outcome, then the trail; scrolls inside a capped body, the footer pinned below. */
function RowDetail({ delegate: d }: { delegate: Delegate }) {
  return (
    <>
      {/* why: while running, the body follows the live step at its bottom; settled, it leads with the outcome. */}
      <div className="sr-x-scroll" ref={isRunning(d) ? followTail : startAtTop}>
        <MetaLine parts={metaParts(d)} />
        <Outcome delegate={d} />
        {d.steps && <Trail delegate={d} steps={trailSteps(d.steps)} />}
      </div>
      <footer className="sr-x-foot">
        <span className="sr-x-hint"><kbd>Esc</kbd> to collapse</span>
      </footer>
    </>
  );
}

function MetaLine({ parts }: { parts: string[] }) {
  return <p className="sr-x-meta">{parts.map((part) => <span key={part}>{part}</span>)}</p>;
}

function Outcome({ delegate: d }: { delegate: Delegate }): JSX.Element | null {
  const { state } = d;
  switch (state.status) {
    case "running": return null;
    case "completed":
      return (
        <OutcomeBlock status={state.status} label="Report" ranFor={state.endedAt - d.startedAt}>
          {state.report ? <Report markdown={state.report} /> : <p className="sr-note">Finished without handing back report text.</p>}
        </OutcomeBlock>
      );
    case "failed":
      return (
        <OutcomeBlock status={state.status} label="Failed" ranFor={state.endedAt - d.startedAt}>
          <p className="sr-note">{state.error ?? "The subagent failed without an error message."}</p>
        </OutcomeBlock>
      );
    case "stopped":
      return (
        <OutcomeBlock status={state.status} label="Stopped" ranFor={state.endedAt - d.startedAt}>
          <p className="sr-note">Stopped after {formatDuration(state.endedAt - d.startedAt)}. Nothing was handed back.</p>
        </OutcomeBlock>
      );
  }
}

type OutcomeBlockProps = { status: DelegateStatus; label: string; ranFor: number; children: ReactNode };

/** A dot in the status colour, the label, and when it ended, over the body. */
function OutcomeBlock({ status, label, ranFor, children }: OutcomeBlockProps) {
  return (
    <div className="sr-out" data-st={status}>
      <div className="sr-out-h">
        <span className="sr-sd" />
        <span className="sr-out-l">{label}</span>
        <span className="sr-tm">{formatOffset(ranFor)}</span>
      </div>
      <div className="sr-out-b">{children}</div>
    </div>
  );
}

/** The report as markdown, clamped; Show more appears only when the clamp hides something. */
function Report({ markdown }: { markdown: string }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <div className="sr-res" data-clamp={!full || undefined} ref={markOverflow}>
        <Markdown className="sr-md" content={markdown} />
      </div>
      <button type="button" className="sr-lnk sr-res-more" aria-expanded={full} onClick={() => setFull(!full)}>
        {full ? "Show less" : "Show more"}
      </button>
    </>
  );
}

const STEPS_SHOWN = 6;

/** The last six steps on a rail, oldest first, "Show N earlier steps" above them; the live step is last. */
function Trail({ delegate: d, steps }: { delegate: Delegate; steps: readonly StepRow[] }) {
  const [all, setAll] = useState(false);
  const running = isRunning(d);
  if (steps.length === 0) return running ? <ol className="sr-trail"><StartingStep /></ol> : null;
  const shown = all ? steps : steps.slice(-STEPS_SHOWN);
  const earlier = steps.length - STEPS_SHOWN;
  return (
    <ol className="sr-trail" aria-label="Steps">
      {earlier > 0 && (
        <li className="sr-step sr-step-more">
          <span className="sr-sd" />
          <button type="button" className="sr-lnk" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? `Show only the last ${STEPS_SHOWN}` : `Show ${earlier} earlier ${earlier === 1 ? "step" : "steps"}`}
          </button>
        </li>
      )}
      {shown.map((row, i) => (
        <Step key={row.id} row={row} live={running && i === shown.length - 1} sinceStart={row.startedAt - d.startedAt} />
      ))}
    </ol>
  );
}

function Step({ row, live, sinceStart }: { row: StepRow; live: boolean; sinceStart: number }) {
  const kind = stepKind(row);
  const label = stepLabel(row);
  const failed = stepFailed(row);
  return (
    <li className="sr-step" data-k={kind} data-step={live ? "live" : failed ? "failed" : "done"} aria-current={live ? "step" : undefined}>
      <span className="sr-sd" />
      {/* why: the label already leads with its verb, so the icon is decoration. */}
      <Icon name={STEP_ICON[kind]} fallback="Circle" className="sr-sk" aria-hidden />
      <span className="sr-stx" title={label}>{label}</span>
      {failed && <span className="sr-sw">failed</span>}
      <span className="sr-tm">{formatOffset(sinceStart)}</span>
    </li>
  );
}

function StartingStep() {
  return (
    <li className="sr-step" data-k="note" data-step="live" aria-current="step">
      <span className="sr-sd" />
      <span />
      <span className="sr-stx">Starting…</span>
    </li>
  );
}

const STEP_ICON: Record<StepKind, string> = {
  command: "Terminal",
  read: "FileText",
  edit: "FilePen",
  search: "Search",
  web: "Globe",
  tool: "Wrench",
  message: "MessageSquare",
  note: "Info",
};

/** When a row finishes growing, the list scrolls just enough to show all of it; never the page. */
function keepGrownRowInView(e: TransitionEvent<HTMLLIElement>) {
  // why: the body's grid-rows grow is the only grid-rows transition inside a row.
  if (e.propertyName === "grid-template-rows") e.currentTarget.scrollIntoView({ block: "nearest" });
}
