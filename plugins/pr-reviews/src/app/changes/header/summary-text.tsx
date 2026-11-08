// The Changes header's summary (ported from code-explorer's summary-text): "N files, +A −D", whose
// tooltip breaks the lines down by kind, a placeholder while the diff loads, or nothing after a
// failed first read. The summary is the tooltip's trigger and takes a tab stop, so the breakdown
// opens from the keyboard too.
import type { LineCounts } from "../../../diff/diff-schema.ts";
import { CHANGE_KIND_LABELS } from "../../../guide/change-kind.ts";
import { Tooltip } from "../../ui/tooltip.tsx";
import { lineStatPartsOf, type ChangeSummary, type KindBreakdown } from "../change-stats.ts";
import { StatText, TONE_CLASSES } from "../stat-text.tsx";

const SUMMARY_CLASS = "min-w-0 max-w-full truncate text-xs text-muted-foreground";

/** What the summary shows: the diff's, the loading placeholder, or nothing. */
export type SummaryState = ChangeSummary | "loading" | null;

export function SummaryText({ summary }: { summary: SummaryState }) {
  if (summary === null) return null;
  if (summary === "loading") {
    return <span role="status" aria-label="Loading changes" className="inline-block h-3 w-24 animate-pulse rounded-sm bg-surface-selected align-middle" />;
  }
  if (summary.counts === null) {
    return (
      <span title={summary.title} className={SUMMARY_CLASS}>
        {summary.text}
      </span>
    );
  }
  const { counts } = summary;
  return (
    <Tooltip content={<BreakdownTable breakdown={summary.breakdown} total={counts} />} placement="bottom-start" className="min-w-0">
      {(describedBy) => (
        <span tabIndex={0} aria-describedby={describedBy} className={`${SUMMARY_CLASS} rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}>
          {summary.text}
          <StatText parts={lineStatPartsOf(counts)} />
        </span>
      )}
    </Tooltip>
  );
}

function BreakdownTable({ breakdown, total }: { breakdown: KindBreakdown; total: LineCounts }) {
  return (
    <span className="grid grid-cols-[auto_auto_auto] gap-x-4 gap-y-1 whitespace-nowrap tabular-nums">
      {breakdown.map((row) => (
        <BreakdownRow key={row.kind} label={CHANGE_KIND_LABELS[row.kind]} counts={row.counts} />
      ))}
      <span className="col-span-3 border-t border-border" />
      <BreakdownRow label="Total" counts={total} />
    </span>
  );
}

function BreakdownRow({ label, counts }: { label: string; counts: LineCounts }) {
  return (
    <>
      <span>{label}</span>
      {lineStatPartsOf(counts).map((part) => (
        <span key={part.tone} className={`text-right ${TONE_CLASSES[part.tone]}`}>
          {part.text}
        </span>
      ))}
    </>
  );
}
