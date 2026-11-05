// The side-panel tab Open thread opens: one delegate's full transcript, drawn
// from its child rows. It reads the strip's own source, so the two always
// show the same delegate in the same state.
import { useState, type JSX, type ReactNode } from "react";
import {
  experimental_Icon as Icon,
  experimental_SourceCode as SourceCode,
  experimental_useTabVisible,
  Markdown,
  type ExperimentalThreadActionTabProps,
} from "@get-bb/plugin-sdk/app";
import type { ReasoningRow, StepRow } from "../bb.ts";
import type { Delegate } from "../delegate.ts";
import { elapsed, isRunning, metaParts, statusWord } from "../roster.ts";
import { isReasoning, stepFailed, stepKind, stepLabel } from "../steps.ts";
import { formatDuration, formatOffset, useNow } from "../clock.ts";
import { useThreadDelegates } from "../source.ts";
import { parseTranscriptParams, TRANSCRIPT_TAB } from "../transcript.ts";
import { Avatar } from "./Avatar.tsx";
import { MetaLine, Outcome, StepIcon } from "./DelegateDetail.tsx";
import { followTail } from "./scroll.ts";

export const TRANSCRIPT_TAB_REGISTRATION = {
  ...TRANSCRIPT_TAB,
  title: "Subagent",
  icon: "UserRound",
  layout: "flush",
  component: TranscriptTab,
} as const;

// why: the declared return type makes an unhandled source status a compile error.
function TranscriptTab({ threadId, params }: ExperimentalThreadActionTabProps): JSX.Element | null {
  const delegateId = parseTranscriptParams(params);
  // why: bb keeps a closed panel's tab mounted; only a showing tab follows the source.
  const live = useThreadDelegates(threadId, { enabled: experimental_useTabVisible() });
  if (!delegateId) return <Note text="Open a subagent from the strip above the composer." />;
  switch (live.status) {
    case "loading": return null;
    case "failed": return <Note text={`The subagents could not be read: ${live.message}`} />;
    case "ready": {
      // why: a child thread opens itself, never this tab.
      const delegate = live.delegates.find((d) => d.id === delegateId && d.origin.kind === "delegation");
      if (!delegate) return <Note text="This subagent is outside the loaded timeline." />;
      return <Transcript delegate={delegate} />;
    }
  }
}

// ---------------------------------------------------------------- layer 2

/** The header, then every step in order, then the report, error, or stop at the end. */
function Transcript({ delegate: d }: { delegate: Delegate }) {
  const steps = d.steps ?? [];
  const running = isRunning(d);
  return (
    <article className="sr-tx">
      <Header delegate={d} />
      {/* why: the reader stays at the live end while it grows, and keeps their place once they scroll up. */}
      <div className="sr-tx-scroll" ref={followTail}>
        <ol className="sr-tx-steps" aria-label="Transcript">
          {steps.map((row, i) => (
            <li key={row.id} className="sr-tx-step">
              <Step row={row} sinceStart={row.startedAt - d.startedAt} live={running && i === steps.length - 1} />
            </li>
          ))}
          {steps.length === 0 && running && <li className="sr-tx-step"><p className="sr-note">Starting…</p></li>}
        </ol>
        <Outcome delegate={d} report="full" />
      </div>
    </article>
  );
}

/** The avatar, title, and status word over the row's meta line, with the elapsed time. */
function Header({ delegate: d }: { delegate: Delegate }) {
  const now = useNow(isRunning(d));
  return (
    <header className="sr-tx-head">
      <Avatar delegate={d} />
      <div className="sr-tx-name">
        <h2 className="sr-tx-title">{d.title}</h2>
        <span className="sr-tx-status" data-st={d.state.status} aria-hidden>{statusWord(d.state.status)}</span>
      </div>
      <span className="sr-el">{formatDuration(elapsed(d, now))}</span>
      <MetaLine parts={metaParts(d)} />
    </header>
  );
}

/** `live`: the delegate's latest step while it runs, drawn as the trail draws its live step. */
type StepProps = { row: StepRow; sinceStart: number; live: boolean };

/** A message as markdown, reasoning as a Thinking block, a command with its output, anything else as one line. */
function Step({ row, sinceStart, live }: StepProps) {
  if (row.kind === "conversation") return <Markdown className="sr-md sr-tx-msg" content={row.text} />;
  if (isReasoning(row)) return <Thinking row={row} />;
  if (row.kind === "work" && row.workKind === "command") return <Command row={row} sinceStart={sinceStart} live={live} />;
  return <StepLine row={row} sinceStart={sinceStart} live={live} />;
}

/** Muted and collapsed: what the subagent thought on the way. */
function Thinking({ row }: { row: ReasoningRow }) {
  const line = (
    <span className="sr-tx-line" data-k="thinking">
      <Icon name="Brain" fallback="Sparkles" className="sr-sk" aria-hidden />
      <span className="sr-stx">Thinking</span>
    </span>
  );
  if (!row.detail) return line;
  return <Disclosure className="sr-tx-think" line={line}><Markdown className="sr-md sr-tx-think-b" content={row.detail} /></Disclosure>;
}

/** The command line opens to its output. */
function Command({ row, ...line }: { row: Extract<StepRow, { workKind: "command" }> } & Omit<StepProps, "row">) {
  return (
    <Disclosure className="sr-tx-cmd" line={<StepLine row={row} {...line} />}>
      {row.output ? <SourceCode className="sr-tx-out" content={row.output} path="output.txt" /> : <p className="sr-note sr-tx-out">No output.</p>}
    </Disclosure>
  );
}

/** A line that opens to a body; the body mounts only while open, so a long transcript stays cheap. */
function Disclosure({ className, line, children }: { className: string; line: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="sr-tx-sum">
        {line}
        <Icon name="ChevronRight" className="sr-tx-chev" aria-hidden />
      </summary>
      {open && children}
    </details>
  );
}

function StepLine({ row, sinceStart, live }: StepProps) {
  const kind = stepKind(row);
  const label = stepLabel(row);
  const failed = stepFailed(row);
  return (
    <span className="sr-tx-line" data-k={kind} data-step={live ? "live" : failed ? "failed" : "done"}>
      <StepIcon kind={kind} />
      <span className="sr-stx" title={label}>{label}</span>
      {failed && <span className="sr-sw">failed</span>}
      <span className="sr-tm">{formatOffset(sinceStart)}</span>
    </span>
  );
}

function Note({ text }: { text: string }) {
  return <p className="sr-tx-empty">{text}</p>;
}
