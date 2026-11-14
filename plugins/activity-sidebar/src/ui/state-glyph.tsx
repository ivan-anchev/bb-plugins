// A Zeron state's glyph, 14 in a 16 box, in its state's hue (app.css `.as-state[data-state]`).
// Under-way states draw the ring; issue 08 animates it, so here it is its still frame.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { STATE_NAME, type ZState } from "../model/state.ts";

const SIZE = 14;

export function StateGlyph({ state }: { state: ZState }) {
  return (
    <span className="as-state" data-state={state} title={STATE_NAME[state]}>
      {glyph(state)}
    </span>
  );
}

function glyph(state: ZState): ReactNode {
  switch (state) {
    case "working":
    case "connecting":
    case "waiting":
      return <StillRing />;
    case "input":
      return (
        <Icon>
          <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </Icon>
      );
    case "approval":
      return (
        <Icon>
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </Icon>
      );
    case "done":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </Icon>
      );
    case "failed":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </Icon>
      );
    case "woke":
      return (
        <Icon>
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 9.5V13l2.25 1.5M3.5 6.5l3-3M20.5 6.5l-3-3M6.75 18.5 5 20.5M17.25 18.5 19 20.5" />
        </Icon>
      );
    default:
      state satisfies never;
      return null;
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** Zeron's ring at rest (ds/status RING): eight even dashes on the 24 grid, in the box's colour. */
function StillRing() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (canvas !== null) drawRestFrame(canvas);
  }, []);
  return <canvas ref={ref} className="as-ring" style={{ width: SIZE, height: SIZE }} aria-hidden />;
}

const HALF_DASH = 10.95; // degrees either side of a dash's centre
const DEG = Math.PI / 180;

function drawRestFrame(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  const ctx = canvas.getContext("2d");
  // why: a 2d context is null only when the canvas already holds another kind; this one never does.
  if (ctx === null) return;
  const u = SIZE / 24;
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = getComputedStyle(canvas).color;
  ctx.lineWidth = 2 * u;
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const mid = 45 * i - 90;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 10 * u, (mid - HALF_DASH) * DEG, (mid + HALF_DASH) * DEG);
    ctx.stroke();
  }
}
