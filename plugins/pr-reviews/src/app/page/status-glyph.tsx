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
    color: "text-success",
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
    shape: <path d="M4.5 1.5h7A3.5 3.5 0 0 1 15 5v3.5a3.5 3.5 0 0 1-3.5 3.5h-3l-4 3v-3A3.5 3.5 0 0 1 1 8.5V5a3.5 3.5 0 0 1 3.5-3.5z" fill="currentColor" />,
  },
  awaiting: {
    color: "text-attention",
    shape: (
      <>
        <circle cx={8} cy={8} r={6.25} fill="none" stroke="currentColor" strokeWidth={1.5} />
        <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
      </>
    ),
  },
  running: {
    color: "text-attention",
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
