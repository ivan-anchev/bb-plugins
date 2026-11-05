// One delegate: a two-line row (avatar with status dot, title over the detail
// line, elapsed time) that expands in place to its meta line, outcome, and step
// trail, with Open thread in its footer. Words come from roster.ts and steps.ts.
import { useId, useRef, useState, type KeyboardEvent, type TransitionEvent } from "react";
import { experimental_Icon as Icon, experimental_useAppPanel, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { StepRow } from "../bb.ts";
import type { Delegate } from "../delegate.ts";
import { detailLine, elapsed, isRunning, metaParts } from "../roster.ts";
import { stepFailed, stepKind, stepLabel, trailSteps } from "../steps.ts";
import { formatDuration, formatOffset, useNow } from "../clock.ts";
import { TRANSCRIPT_TAB, transcriptParams } from "../transcript.ts";
import { Avatar } from "./Avatar.tsx";
import { MetaLine, Outcome, StepIcon } from "./DelegateDetail.tsx";
import { RollingText } from "./Motion.tsx";
import { followTail, startAtTop } from "./scroll.ts";

type RowProps = { delegate: Delegate; expanded: boolean; onToggle: () => void };

export function DelegateRow({ delegate: d, expanded, onToggle }: RowProps) {
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
        <Avatar delegate={d} />
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
        <Outcome delegate={d} report="clamped" />
        {d.steps && <Trail delegate={d} steps={trailSteps(d.steps)} />}
      </div>
      <footer className="sr-x-foot">
        {opens(d) && <OpenThreadButton delegate={d} />}
        <span className="sr-x-hint"><kbd>Esc</kbd> to collapse</span>
      </footer>
    </>
  );
}

/**
 * Opens where the delegate lives. A child thread is a bb thread, so it opens
 * that thread. A delegation is not (a Claude Code childRef is a tool-use id),
 * so its transcript opens in the side panel, or its tab is focused if open.
 */
function OpenThreadButton({ delegate: d }: { delegate: Delegate }) {
  const panel = experimental_useAppPanel();
  const navigate = useBbNavigate();
  const open = () => {
    switch (d.origin.kind) {
      case "delegation":
        panel.openTab({ tab: TRANSCRIPT_TAB, params: transcriptParams(d.id), title: d.title });
        return;
      case "child-thread":
        navigate.toThread(d.origin.threadId);
        return;
      default:
        return d.origin satisfies never; // why: our own type, so a new origin is a compile error here
    }
  };
  return (
    <button type="button" className="sr-open" onClick={open}>
      Open thread
      <Icon name="ArrowUpRight" fallback="ExternalLink" className="sr-open-icon" aria-hidden />
    </button>
  );
}

// why: a provider that sends no child rows (ACP) leaves no transcript to open; a child thread always opens.
function opens(d: Delegate): boolean {
  return d.origin.kind === "child-thread" || d.steps !== null;
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
      <StepIcon kind={kind} />
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

/** When a row finishes growing, the list scrolls just enough to show all of it; never the page. */
function keepGrownRowInView(e: TransitionEvent<HTMLLIElement>) {
  // why: the body's grid-rows grow is the only grid-rows transition inside a row.
  if (e.propertyName === "grid-template-rows") e.currentTarget.scrollIntoView({ block: "nearest" });
}
