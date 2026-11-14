// The tooltip and keyboard scrubbing across the grid's cells.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const EDGE = 96;

// Days run in order down each week column: up/down is a day, left/right a week.
const STEPS: Partial<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };

/**
 * One active mark at a time, driven by pointer or arrow keys. Marks carry
 * `data-i`; the plot is one tab stop and the arrows move within it.
 */
export function useScrub(opts: { count: number; describe: (i: number) => string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; shift: string; text: string } | null>(null);

  function place(i: number | null) {
    setActive(i);
    const root = rootRef.current;
    const mark = i === null ? null : plotRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (i === null || !root || !mark) return setTip(null);
    const r = root.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    const x = m.left + m.width / 2 - r.left;
    // anchor the tooltip's edge instead of its centre near the graph's sides
    const shift = x < EDGE ? "0%" : x > r.width - EDGE ? "-100%" : "-50%";
    setTip({ x, y: m.top - r.top, shift, text: opts.describe(i) });
  }

  const plotProps = {
    ref: plotRef,
    tabIndex: 0,
    onPointerMove: (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (el) place(Number(el.dataset.i));
    },
    onPointerLeave: () => place(null),
    onBlur: () => place(null),
    onFocus: () => place(active ?? opts.count - 1),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Home") return e.preventDefault(), place(0);
      if (e.key === "End") return e.preventDefault(), place(opts.count - 1);
      const d = STEPS[e.key];
      if (d === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const next = (active ?? opts.count - 1) + d;
      if (next >= 0 && next < opts.count) place(next);
    },
  };

  const tooltip = (
    <>
      <div
        className="ag-tip"
        aria-hidden="true"
        data-show={tip ? "" : undefined}
        style={tip ? { transform: `translate(calc(${tip.x}px + ${tip.shift}), calc(${tip.y}px - 100% - 6px))` } : undefined}
      >
        {tip?.text}
      </div>
      <span className="ag-sr" aria-live="polite">{tip?.text}</span>
    </>
  );

  return { rootRef, plotProps, active, tooltip };
}
