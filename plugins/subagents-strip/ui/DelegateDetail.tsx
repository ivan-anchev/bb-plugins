// What a delegate's detail shows wherever it appears, the expanded row and
// the transcript tab alike: the meta line, the outcome, and a step's kind icon.
import { useState, type JSX, type ReactNode } from "react";
import { experimental_Icon as Icon, Markdown } from "@get-bb/plugin-sdk/app";
import type { Delegate, DelegateStatus } from "../delegate.ts";
import type { StepKind } from "../steps.ts";
import { formatDuration, formatOffset } from "../clock.ts";
import { markOverflow } from "./scroll.ts";

export function MetaLine({ parts }: { parts: string[] }) {
  return <p className="sr-x-meta">{parts.map((part) => <span key={part}>{part}</span>)}</p>;
}

/**
 * The report, error, or stop note under a dot in the status colour. The row
 * clamps the report behind Show more; the transcript shows all of it.
 */
export function Outcome({ delegate: d, report }: { delegate: Delegate; report: "clamped" | "full" }): JSX.Element | null {
  const { state } = d;
  switch (state.status) {
    case "running": return null;
    case "completed":
      return (
        <OutcomeBlock status={state.status} label="Report" ranFor={state.endedAt - d.startedAt}>
          {!state.report ? <p className="sr-note">Finished without handing back report text.</p>
            : report === "clamped" ? <ClampedReport markdown={state.report} />
            : <Markdown className="sr-md sr-res" content={state.report} />}
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

/** The step's kind as an icon; decoration, since every label leads with its verb. */
export function StepIcon({ kind }: { kind: StepKind }) {
  return <Icon name={STEP_ICON[kind]} fallback="Circle" className="sr-sk" aria-hidden />;
}

// ---------------------------------------------------------------- layer 2

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
function ClampedReport({ markdown }: { markdown: string }) {
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
