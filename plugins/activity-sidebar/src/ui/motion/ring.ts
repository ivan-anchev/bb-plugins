import { useLayoutEffect, type RefObject } from "react";
import { onReducedMotionChange, reducedMotion } from "./reduced-motion.ts";

const RUN = 3.9;
const REST = 900;
const PERIOD = RUN * 1000 + REST;
const FRAME = 1000 / 30;
const DEG = Math.PI / 180;

/** One dash: its arc in degrees clockwise from 12 o'clock, and how far its ink leans away from grey, 0 to 0.6. */
export type Dash = { from: number; to: number; lift: number };

/** The ring `ms` into its period; `still`, its rest frame: eight even dashes. */
export function ringDashes(ms: number, still: boolean): Dash[] {
  const ph = Math.min(ms / 1000, RUN);
  const amp = still ? 0 : smooth(0, 0.55, ph) * (1 - smooth(RUN - 0.75, RUN, ph));
  const tau = ph / RUN;
  const lead = 720 * (0.5 - 0.5 * Math.cos(Math.PI * tau));
  const pull = lead - 14 * Math.sin(Math.PI * tau);
  return Array.from({ length: 8 }, (_, i) => {
    const c = 45 * i;
    let dl = pull - c;
    dl -= 360 * Math.round(dl / 360);
    const sig = dl < 0 ? 26 : 40;
    const g = amp * Math.exp(-(dl * dl) / (sig * sig));
    const mid = c + Math.sign(dl) * 9 * g;
    const half = 10.95 * (1 + 1.3 * g);
    return { from: mid - half, to: mid + half, lift: 0.6 * g };
  });
}

/** Draws `canvas` as the ring, `size` px square, on the shared clock while it is mounted. */
export function useRing(canvas: RefObject<HTMLCanvasElement | null>, size: number): void {
  useLayoutEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const ring = { canvas: el, size };
    join(ring);
    return () => leave(ring);
  }, [canvas, size]);
}

type Ring = { canvas: HTMLCanvasElement; size: number };

const rings = new Set<Ring>();
let frame = 0;
let unlisten: (() => void) | null = null;

function join(ring: Ring): void {
  rings.add(ring);
  draw(ring, phase(performance.now()), reducedMotion());
  unlisten ??= onReducedMotionChange(redrawAll);
  run();
}

function leave(ring: Ring): void {
  rings.delete(ring);
  if (rings.size > 0) return;
  cancelAnimationFrame(frame);
  frame = 0;
  unlisten?.();
  unlisten = null;
}

function run(): void {
  if (frame === 0 && !reducedMotion()) frame = requestAnimationFrame(tick);
}

function redrawAll(): void {
  const still = reducedMotion();
  for (const ring of rings) draw(ring, phase(performance.now()), still);
  run();
}

let lastFrame = -1;

function tick(now: number): void {
  if (reducedMotion()) {
    frame = 0;
    return;
  }
  const at = Math.floor(now / FRAME);
  if (at !== lastFrame) {
    lastFrame = at;
    for (const ring of rings) draw(ring, phase(at * FRAME), false);
  }
  frame = requestAnimationFrame(tick);
}

function phase(now: number): number {
  return now % PERIOD;
}

function draw({ canvas, size }: Ring, ms: number, still: boolean): void {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const ink = inkOf(getComputedStyle(canvas).color);
  const toward = 0.2126 * ink.r + 0.7152 * ink.g + 0.0722 * ink.b > 127.5 ? 255 : 0;
  const u = size / 24;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 2 * u;
  ctx.lineCap = "round";
  for (const dash of ringDashes(ms, still)) {
    const mix = (c: number) => Math.round(c + (toward - c) * dash.lift);
    ctx.strokeStyle = `rgba(${mix(ink.r)},${mix(ink.g)},${mix(ink.b)},${ink.a})`;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 10 * u, (dash.from - 90) * DEG, (dash.to - 90) * DEG);
    ctx.stroke();
  }
}

type Ink = { r: number; g: number; b: number; a: number };
const inks = new Map<string, Ink>();
let probe: CanvasRenderingContext2D | null = null;

function inkOf(color: string): Ink {
  const known = inks.get(color);
  if (known !== undefined) return known;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (probe === null) throw new Error("activity-sidebar: no 2d canvas to read the ring's ink");
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const ink = { r, g, b, a: a / 255 };
  inks.set(color, ink);
  return ink;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
