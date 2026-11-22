import { useState, type JSX, type ReactNode } from "react";
import {
  experimental_Icon as Icon,
  experimental_SourceCode as SourceCode,
  experimental_useTabVisible,
  Markdown,
} from "@get-bb/plugin-sdk/app";
import type { ReasoningRow, StepRow } from "../bb.ts";
import type { Delegate, DelegateId } from "../delegate.ts";
import { elapsed, isRunning, metaParts, statusWord } from "../roster.ts";
import { isReasoning, messageText, stepFailed, stepKind, stepLabel } from "../steps.ts";
import { formatDuration, formatOffset, useNow } from "../clock.ts";
import { useThreadDelegates } from "../source.ts";
import { transcriptItems, type WorkItem } from "../work-groups.ts";
import { Avatar } from "./Avatar.tsx";
import { MetaLine, Outcome, StepIcon } from "./DelegateDetail.tsx";
import { followTail } from "./scroll.ts";

export function TranscriptTab({ threadId, delegateId }: { threadId: string; delegateId: DelegateId }): JSX.Element | null {
  const live = useThreadDelegates(threadId, { enabled: experimental_useTabVisible(), history: true });
  switch (live.status) {
    case "loading": return null;
    case "failed": return <Note text={`The subagents could not be read: ${live.message}`} />;
    case "ready": {
      const delegate = live.delegates.find((d) => d.id === delegateId && d.origin.kind === "delegation");
      if (!delegate) return <Note text="This subagent is outside the loaded timeline." />;
      if (live.outlined.has(delegate.id)) return <Note text="Loading its steps and report…" />;
      return <Transcript delegate={delegate} />;
    }
  }
}

function Transcript({ delegate: d }: { delegate: Delegate }) {
  const items = transcriptItems(d);
  return (
    <article className="sr-tx">
      <Header delegate={d} />
      <div className="sr-tx-scroll" ref={followTail}>
        <ol className="sr-tx-items" aria-label="Transcript">
          {items.map((item) => (
            <li key={item.kind === "group" ? item.id : item.step.id} className="sr-tx-item">
              <Line item={item} startedAt={d.startedAt} />
            </li>
          ))}
          {items.length === 0 && isRunning(d) && <li className="sr-tx-item"><p className="sr-note">Starting…</p></li>}
        </ol>
        <Outcome delegate={d} report="full" />
      </div>
    </article>
  );
}

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

function Line({ item, startedAt }: { item: WorkItem; startedAt: number }) {
  if (item.kind === "group") return <WorkGroup group={item} startedAt={startedAt} />;
  return <Step row={item.step} sinceStart={item.step.startedAt - startedAt} live={item.live} />;
}

function WorkGroup({ group, startedAt }: { group: Extract<WorkItem, { kind: "group" }>; startedAt: number }) {
  const line = (
    <span className="sr-tx-line" data-k="group" data-step={group.live ? "live" : "done"}>
      <span className="sr-stx" title={group.label}>{group.label}</span>
      {group.note && <span className="sr-sw">{group.note}</span>}
    </span>
  );
  return (
    <Disclosure className="sr-tx-grp" line={line}>
      <ol className="sr-tx-grp-steps">
        {group.steps.map((row) => <li key={row.id}><Step row={row} sinceStart={row.startedAt - startedAt} live={false} /></li>)}
      </ol>
    </Disclosure>
  );
}

type StepProps = { row: StepRow; sinceStart: number; live: boolean };

function Step({ row, sinceStart, live }: StepProps) {
  if (row.kind === "conversation") {
    const text = messageText(row.text);
    return text === null ? <StepLine row={row} sinceStart={sinceStart} live={live} /> : <Markdown className="sr-md sr-tx-msg" content={text} />;
  }
  if (isReasoning(row)) return <Thinking row={row} live={live} />;
  if (row.kind === "work" && row.workKind === "command") return <Command row={row} sinceStart={sinceStart} live={live} />;
  return <StepLine row={row} sinceStart={sinceStart} live={live} />;
}

function Thinking({ row, live }: { row: ReasoningRow; live: boolean }) {
  const line = (
    <span className="sr-tx-line" data-k="thinking" data-step={live ? "live" : "done"}>
      <Icon name="Brain" fallback="Sparkles" className="sr-sk" aria-hidden />
      <span className="sr-stx">Thinking</span>
    </span>
  );
  if (!row.detail) return line;
  return <Disclosure className="sr-tx-think" line={line}><Markdown className="sr-md sr-tx-think-b" content={row.detail} /></Disclosure>;
}

function Command({ row, ...line }: { row: Extract<StepRow, { workKind: "command" }> } & Omit<StepProps, "row">) {
  return (
    <Disclosure className="sr-tx-cmd" line={<StepLine row={row} {...line} />}>
      {row.output ? <SourceCode className="sr-tx-out" content={row.output} path="output.txt" /> : <p className="sr-note sr-tx-out">No output.</p>}
    </Disclosure>
  );
}

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
