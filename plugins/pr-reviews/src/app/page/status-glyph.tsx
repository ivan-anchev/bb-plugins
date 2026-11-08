// The glyphs for where a check or a review stands, shared by the header's checks verdict, the check
// rows and the reviewer rows, so an approval and a passing check look alike. Done is a solid disc
// with its mark cut out; still to come is yellow: a half disc for a review, an arc for a check.
// why our own SVG: bb's icon set has only outline circles. Each glyph is 14px like the icons
// beside it, and decorative: the row's text names the status.
import type { ReactNode } from "react";

export type StatusGlyphName = "passed" | "failed" | "commented" | "awaiting" | "running";

export function StatusGlyph({ name }: { name: StatusGlyphName }) {
  const glyph = GLYPHS[name];
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`size-3.5 shrink-0 ${glyph.color}`}>
      {glyph.shape}
    </svg>
  );
}

// why: bb has no darker variant of --attention for small marks. On white it is 2.35:1, under the
// 3:1 a graphic needs; a quarter of the foreground keeps its hue and reads 3.47:1 in light, and
// barely moves it in dark (9.8:1).
const ATTENTION = "text-[color-mix(in_oklab,var(--attention)_75%,var(--foreground))]";

// The mark is drawn in the page colour, so it reads as cut out of the disc in either theme.
const MARK = {
  fill: "none",
  stroke: "var(--background)",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const DISC = <circle cx={8} cy={8} r={7} fill="currentColor" />;

const GLYPHS = {
  passed: {
    color: "text-success-foreground",
    shape: (
      <>
        {DISC}
        <path d="M5 8.25 7 10.25 11 6" {...MARK} />
      </>
    ),
  },
  failed: {
    color: "text-destructive-text",
    shape: (
      <>
        {DISC}
        <path d="M5.75 5.75 10.25 10.25M10.25 5.75 5.75 10.25" {...MARK} />
      </>
    ),
  },
  commented: {
    color: "text-muted-foreground",
    shape: (
      <>
        {DISC}
        {[5, 8, 11].map((x) => (
          <circle key={x} cx={x} cy={8} r={1} fill="var(--background)" />
        ))}
      </>
    ),
  },
  awaiting: {
    color: ATTENTION,
    shape: (
      <>
        <circle cx={8} cy={8} r={6.25} fill="none" stroke="currentColor" strokeWidth={1.5} />
        <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
      </>
    ),
  },
  // A faint track with three quarters drawn from twelve o'clock. Static: a check can run for an hour.
  running: {
    color: ATTENTION,
    shape: (
      <>
        <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.3} />
        <circle
          cx={8}
          cy={8}
          r={6}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          pathLength={4}
          strokeDasharray="3 1"
          transform="rotate(-90 8 8)"
        />
      </>
    ),
  },
} as const satisfies Record<StatusGlyphName, { color: string; shape: ReactNode }>;
