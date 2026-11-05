import { Tooltip } from "../../ui/tooltip.tsx";
import { CHANGE_KIND_LABELS } from "../change-kind.ts";
import { lineStatPartsOf, type ChangeSummary, type KindBreakdown, type LineStats, type StatPart } from "../change-stats.ts";

const TONE_CLASSES: Record<StatPart["tone"], string> = {
  added: "text-diff-added",
  removed: "text-diff-removed",
  muted: "text-muted-foreground",
};

const SUMMARY_CLASSES = "min-w-0 max-w-full shrink-0 pl-2.5 text-xs text-muted-foreground";

export function SummaryText({ summary }: { summary: ChangeSummary | null }) {
  if (summary === null) {
    return (
      <span
        role="status"
        aria-label="Loading changes"
        className="inline-block h-3 w-24 animate-pulse rounded-sm bg-surface-selected align-middle"
      />
    );
  }
  if (summary.stats === null) {
    return (
      <span title={summary.title} className={`truncate ${SUMMARY_CLASSES}`}>
        {summary.text}
      </span>
    );
  }
  return (
    <Tooltip content={<BreakdownTable breakdown={summary.breakdown} total={summary.stats} />} className={SUMMARY_CLASSES}>
      {summary.text}
      <StatText parts={lineStatPartsOf(summary.stats)} />
    </Tooltip>
  );
}

function StatText({ parts }: { parts: readonly StatPart[] }) {
  return (
    <span className="whitespace-nowrap">
      {parts.map((part, index) => (
        <span key={part.tone}>
          {index === 0 ? null : " "}
          <span className={TONE_CLASSES[part.tone]}>{part.text}</span>
        </span>
      ))}
    </span>
  );
}

function BreakdownTable({ breakdown, total }: { breakdown: KindBreakdown; total: LineStats }) {
  return (
    <span className="grid grid-cols-[auto_auto_auto] gap-x-4 gap-y-1 whitespace-nowrap tabular-nums">
      {breakdown.rows.map((row) => (
        <BreakdownRow key={row.kind} label={CHANGE_KIND_LABELS[row.kind]} stats={row.stats} />
      ))}
      <span className="col-span-3 border-t border-border" />
      <BreakdownRow label={breakdown.totalLabel} stats={total} />
    </span>
  );
}

function BreakdownRow({ label, stats }: { label: string; stats: LineStats }) {
  return (
    <>
      <span>{label}</span>
      {lineStatPartsOf(stats).map((part) => (
        <span key={part.tone} className={`text-right ${TONE_CLASSES[part.tone]}`}>
          {part.text}
        </span>
      ))}
    </>
  );
}
