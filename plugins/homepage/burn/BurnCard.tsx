// The Burn card: the flame, "Burn" and a Week/Month switch on top; spend over tokens at the bottom,
// each with its change against the period before. Or one line saying why Burn can't be read.
import type { BurnRange, BurnTotals } from "../contract.ts";
import { describeChange, formatMoney, formatTokens, type Change } from "./format.ts";

export type BurnView = { kind: "loading" } | { kind: "ready"; totals: BurnTotals } | { kind: "unavailable"; message: string };

const RANGES: readonly { range: BurnRange; label: string }[] = [
  { range: "7d", label: "Week" },
  { range: "30d", label: "Month" },
];

export function BurnCard(props: { range: BurnRange; onRange: (range: BurnRange) => void; view: BurnView }) {
  const { range, view } = props;
  return (
    <section className="hp-card bn-card" aria-label="Burn" aria-busy={view.kind === "loading" || undefined}>
      <div className="hp-head bn-head">
        <Flame />
        <span>Burn</span>
        {view.kind !== "unavailable" && <RangeSwitch range={range} onRange={props.onRange} />}
      </div>
      {view.kind === "unavailable" ? (
        <p className="hp-caption bn-reason" role="status">
          {view.message}
        </p>
      ) : view.kind === "loading" ? (
        <Skeleton />
      ) : (
        <dl className="bn-body">
          <Metric
            label="Spent"
            value={formatMoney(view.totals.total)}
            change={describeChange(view.totals.total, view.totals.previousTotal, range, "spend")}
          />
          <Metric
            label="Tokens"
            value={formatTokens(view.totals.tokens)}
            change={describeChange(view.totals.tokens, view.totals.previousTokens, range, "tokens")}
          />
        </dl>
      )}
    </section>
  );
}

function RangeSwitch({ range, onRange }: { range: BurnRange; onRange: (range: BurnRange) => void }) {
  return (
    <div className="bn-switch" role="group" aria-label="Period">
      {RANGES.map((option) => (
        <button
          key={option.range}
          type="button"
          className="bn-option"
          aria-pressed={option.range === range}
          onClick={() => onRange(option.range)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value, change }: { label: string; value: string; change: Change }) {
  return (
    <div className="bn-metric">
      <dt className="bn-label">{label}</dt>
      <dd className="bn-line">
        <span className="bn-value">{value}</span>
        <span className="bn-change" data-direction={change.direction} title={change.full}>
          <span aria-hidden="true">{change.short}</span>
          <span className="bn-sr">{change.spoken}</span>
        </span>
      </dd>
    </div>
  );
}

/** The ready card's two metrics as blocks on lines of the same heights, so nothing moves when the numbers land. */
function Skeleton() {
  return (
    <div className="bn-body" aria-hidden="true">
      {[
        { label: 34, value: 92 },
        { label: 44, value: 78 },
      ].map((widths, i) => (
        <div key={i} className="bn-metric">
          <span className="bn-label bn-skel">
            <span className="bn-bone" style={{ width: widths.label, height: 10 }} />
          </span>
          <span className="bn-line bn-skel">
            <span className="bn-bone" style={{ width: widths.value, height: 26 }} />
            <span className="bn-bone" style={{ width: 44, height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Burn's flame, at the size and weight of the homepage's other card icons. */
function Flame() {
  return (
    <svg
      className="hp-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
