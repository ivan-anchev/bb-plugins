import { useId, type Ref } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { DelegateId } from "../delegate.ts";
import { batchCensus, type Batch } from "../roster.ts";
import { formatClockTime } from "../clock.ts";
import { DelegateRow } from "./DelegateRow.tsx";

type Props = {
  batch: Batch;
  open: boolean;
  onToggle: () => void;
  expanded: DelegateId | null;
  onToggleRow: (id: DelegateId) => void;
  /** Delegates read from the history's outline only (ThreadDelegates.outlined). */
  outlined: ReadonlySet<DelegateId>;
  /** A row's element ref, for the row the tab lands on. */
  rowRef: (id: DelegateId) => Ref<HTMLLIElement> | undefined;
};

export function BatchSection({ batch, open, onToggle, expanded, onToggleRow, outlined, rowRef }: Props) {
  const rowsId = useId();
  const time = formatClockTime(batch.startedAt);
  return (
    <li className="sr-batch" data-open={open || undefined}>
      <div className="sr-batch-h">
        <button type="button" className="sr-batch-label" aria-expanded={open} aria-controls={rowsId} title={`${time} · ${batch.prompt ?? batch.label}`} onClick={onToggle}>
          <Icon name="ChevronRight" className="sr-batch-caret" aria-hidden />
          <span className="sr-batch-t">
            <span className="sr-batch-tm">{time}</span>
            <span className="sr-batch-q">{batch.label}</span>
          </span>
          <span className="sr-batch-c">
            {batchCensus(batch.delegates).map((p) => <span key={p.status} data-st={p.status}>{p.count} {p.word}</span>)}
          </span>
        </button>
      </div>
      <div className="sr-batch-wrap">
        <div className="sr-batch-clip">
          <ol className="sr-batch-rows" id={rowsId} inert={!open}>
            {batch.delegates.map((d) => (
              <DelegateRow key={d.id} ref={rowRef(d.id)} delegate={d} outlined={outlined.has(d.id)} expanded={d.id === expanded} onToggle={() => onToggleRow(d.id)} />
            ))}
          </ol>
        </div>
      </div>
    </li>
  );
}
