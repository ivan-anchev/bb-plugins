// A finding's priority as the reader sees it: a word in the theme's colour for how much it matters.
import type { Finding } from "../../guide/guide-schema.ts";

// why the arbitrary value: bb's theme has a warning text colour but no Tailwind utility for it.
const PRIORITIES = {
  p0: { word: "Must fix", colour: "text-destructive" },
  p1: { word: "Should fix", colour: "text-[var(--warning-text)]" },
  p2: { word: "Nit", colour: "text-muted-foreground" },
} as const satisfies Record<Finding["priority"], { word: string; colour: string }>;

export function Priority({ priority }: { priority: Finding["priority"] }) {
  const { word, colour } = PRIORITIES[priority];
  return <span className={`shrink-0 whitespace-nowrap text-xs font-semibold ${colour}`}>{word}</span>;
}
