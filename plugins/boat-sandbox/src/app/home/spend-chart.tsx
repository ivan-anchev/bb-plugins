// Thirty days of spend, a bar a UTC day, today last and lighter; a day with nothing spent or recorded
// is a 3px well. The pointer or the arrow keys pick a day, and a tooltip over the axis reads it.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SpendDay } from "../../spend/history.ts";
import { dayLabel, daySpend } from "./format.ts";

const HEIGHT = 64;
const WELL = 3;
/** The shortest bar that still reads as spend. */
const FLOOR = 4;
/** Within this of either side the tooltip anchors to that side, not the day's centre, so it stays in the card. */
const EDGE = 72;

export function SpendChart({ days }: { days: readonly SpendDay[] }) {
  const max = Math.max(...days.map((day) => day.dollars ?? 0));
  const scrub = useScrub(days.length, (i) => describe(days[i]!, i === days.length - 1));
  return (
    <div {...scrub.rootProps} className="bs-chart">
      <div
        {...scrub.plotProps}
        className="bs-plot"
        role="img"
        aria-label="Spend per day, last 30 days. Use the arrow keys to read each day."
      >
        {days.map((day, i) => (
          <span
            key={day.day}
            className="bs-bar"
            data-zero={!day.dollars || undefined}
            data-today={i === days.length - 1 || undefined}
            data-active={scrub.active === i || undefined}
            style={{ height: barHeight(day.dollars, max) }}
          />
        ))}
      </div>
      <div className="bs-axis bs-caption" aria-hidden>
        <span>{dayLabel(days[0]!.day)}</span>
        <span>Today</span>
      </div>
      {scrub.tooltip}
    </div>
  );
}

const barHeight = (dollars: number | null, max: number): number =>
  !dollars ? WELL : Math.max(FLOOR, (dollars / max) * HEIGHT);

/** `Nov 10 · $0.36`, `Today · No spend`, `Oct 20 · Not recorded`. */
function describe(day: SpendDay, today: boolean): string {
  const amount = day.dollars === null ? "Not recorded" : day.dollars === 0 ? "No spend" : daySpend(day.dollars);
  return `${today ? "Today" : dayLabel(day.day)} · ${amount}`;
}

/**
 * One picked day at a time. The pointer picks by its x over the plot, so a 3px well is as easy to
 * reach as a bar; the plot is one tab stop, and ←/→, Home and End move within it. The tooltip stays
 * while the pointer is anywhere on the chart, the tooltip included, or the plot has focus, and Escape
 * closes it wherever focus is.
 */
function useScrub(count: number, read: (i: number) => string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; shift: string } | null>(null);

  function pick(i: number | null) {
    setActive(i);
    const root = rootRef.current;
    const bar = i === null ? undefined : plotRef.current?.children[i];
    if (i === null || root === null || bar === undefined) return setTip(null);
    const r = root.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const centre = b.left + b.width / 2 - r.left;
    // Near a side the tooltip sits flush with it, covering that side's axis caption whole.
    const [x, shift] = centre < EDGE ? [0, "0%"] : centre > r.width - EDGE ? [r.width, "-100%"] : [centre, "-50%"];
    // why the plot's bottom: the tooltip covers the axis captions, never the header above the chart.
    const y = plotRef.current!.getBoundingClientRect().bottom - r.top + 2;
    setTip({ x, y, shift });
  }

  const at = (clientX: number): number => {
    const plot = plotRef.current!.getBoundingClientRect();
    return Math.min(count - 1, Math.max(0, Math.floor(((clientX - plot.left) / plot.width) * count)));
  };

  const shown = tip !== null;
  useEffect(() => {
    if (!shown) return;
    const close = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") pick(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [shown]);

  const rootProps = {
    ref: rootRef,
    onPointerLeave: () => {
      if (document.activeElement !== plotRef.current) pick(null);
    },
  };

  const plotProps = {
    ref: plotRef,
    tabIndex: 0,
    onPointerMove: (e: PointerEvent) => pick(at(e.clientX)),
    onPointerDown: (e: PointerEvent) => pick(at(e.clientX)),
    onBlur: () => {
      if (!rootRef.current!.matches(":hover")) pick(null);
    },
    onFocus: () => pick(active ?? count - 1),
    onKeyDown: (e: KeyboardEvent) => {
      const from = active ?? count - 1;
      const moves: Partial<Record<string, number>> = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: count - 1 };
      const next = moves[e.key];
      if (next === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      pick(Math.min(count - 1, Math.max(0, next)));
    },
  };

  // why at render: a refresh brings new days, and an open tooltip reads the day it points at now.
  const text = tip === null || active === null ? null : read(active);
  const tooltip = (
    <>
      <div
        className="bs-tip"
        aria-hidden
        data-show={tip !== null || undefined}
        style={tip === null ? undefined : { transform: `translate(calc(${tip.x}px + ${tip.shift}), ${tip.y}px)` }}
      >
        {text}
      </div>
      <span className="bs-sr" aria-live="polite">
        {text}
      </span>
    </>
  );

  return { rootProps, plotProps, active, tooltip };
}
