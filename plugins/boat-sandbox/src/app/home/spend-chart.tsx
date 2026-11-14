// Thirty days of spend, a bar a UTC day, today last and lighter; a day with nothing spent or recorded
// is a 3px well. The pointer or the arrow keys pick a day, and a tooltip over the axis reads it. While
// some days are unrecorded, the axis offers to backfill them.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { SpendDay } from "../../spend/history.ts";
import { dayLabel, daySpend } from "./format.ts";

const WELL = 3;
/** The shortest bar that still reads as spend. */
const FLOOR = 4;
/** Within this of either side the tooltip anchors to that side, not the day's centre, so it stays in the card. */
const EDGE = 72;

/** The axis's backfill button while some days are unrecorded. */
export interface Backfill {
  /** `Backfill 30 days`, `Backfilling…`, `Filled 3 days`. */
  label: string;
  /** A press does nothing while one is under way or its result shows. */
  busy: boolean;
  /** Why the last press failed, in one line under the chart. */
  failure: string | null;
  /** Resolves true when every unrecorded day was filled, so the button goes. */
  run(): Promise<boolean>;
}

export function SpendChart({ days, backfill }: { days: readonly SpendDay[]; backfill: Backfill | null }) {
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
      <div className="bs-axis bs-caption">
        <span aria-hidden>{dayLabel(days[0]!.day)}</span>
        {backfill !== null && (
          // why on enter: the tooltip can cover the button, which sits above it; reaching the button closes it.
          <span className="bs-backfill" aria-live="polite" onPointerEnter={scrub.close}>
            <button type="button" className="bs-backfill-button" aria-disabled={backfill.busy || undefined} onClick={press}>
              {backfill.label}
            </button>
          </span>
        )}
        <span className="bs-today" aria-hidden>
          Today
        </span>
      </div>
      {scrub.tooltip}
      {backfill !== null && backfill.failure !== null && (
        <p className="bs-caption bs-stale" role="alert">
          <Icon name="AlertTriangle" className="bs-stale-icon" aria-hidden />
          <span>{backfill.failure}</span>
        </p>
      )}
    </div>
  );

  /**
   * A keyboard press that fills every day takes the button away, so focus still on it moves on to the
   * plot. Focus the user took elsewhere while the backfill ran stays there.
   */
  async function press(e: MouseEvent<HTMLButtonElement>) {
    if (backfill === null || backfill.busy) return;
    const button = e.currentTarget;
    const fromKeyboard = button.matches(":focus-visible");
    const filledAll = await backfill.run();
    // why the body too: the button may already be gone, and focus dropped with it to the page.
    const stayed = document.activeElement === button || document.activeElement === document.body;
    if (filledAll && fromKeyboard && stayed) scrub.focus();
  }
}

/** A share of the plot, not pixels: the stylesheet sets the plot's height, taller when the card splits. */
const barHeight = (dollars: number | null, max: number): string =>
  !dollars ? `${WELL}px` : `max(${FLOOR}px, ${(dollars / max) * 100}%)`;

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

  return { rootProps, plotProps, active, tooltip, close: () => pick(null), focus: () => plotRef.current?.focus() };
}
