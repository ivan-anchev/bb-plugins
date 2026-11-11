// The small glyphs in front of the activity's lines: a commit, a label, a review, an approval, a
// merge. bb's icons where it has one (the merge, a branch, a link); why our own SVG for the rest:
// bb's icon set has no commit, label, person or pencil. Each is 14px, drawn in its line's glyph
// colour, and decorative: the line's words say what happened.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

const BB_ICONS = { merged: "GitMerge", branch: "GitBranch", mention: "Link" } as const;

export type ActivityGlyphName = keyof typeof SHAPES | keyof typeof BB_ICONS;

const isBbIcon = (name: ActivityGlyphName): name is keyof typeof BB_ICONS => name in BB_ICONS;

export function ActivityGlyph({ name }: { name: ActivityGlyphName }) {
  if (isBbIcon(name)) return <Icon name={BB_ICONS[name]} aria-hidden className="size-3.5 shrink-0" />;
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      {SHAPES[name]}
    </svg>
  );
}

const SHAPES = {
  commit: (
    <>
      <circle cx={8} cy={8} r={2.75} />
      <path d="M1.25 8h4M10.75 8h4" />
    </>
  ),
  label: (
    <>
      <path d="M1.75 2.75v4.1c0 .4.16.78.44 1.06l5.9 5.9a1.5 1.5 0 0 0 2.12 0l3.6-3.6a1.5 1.5 0 0 0 0-2.12l-5.9-5.9a1.5 1.5 0 0 0-1.06-.44h-4.1a1 1 0 0 0-1 1z" />
      <circle cx={5} cy={5} r={0.9} fill="currentColor" stroke="none" />
    </>
  ),
  review: <path d="M2.25 8a5.75 5.75 0 1 1 2.6 4.8l-2.85.95.95-2.7A5.7 5.7 0 0 1 2.25 8z" />,
  approved: (
    <>
      <circle cx={8} cy={8} r={6.25} />
      <path d="M5.25 8.25 7.1 10.1 10.75 6.25" />
    </>
  ),
  "changes-requested": (
    <>
      <circle cx={8} cy={8} r={6.25} />
      <path d="M8 4.75v4M8 11.1v.15" />
    </>
  ),
  person: (
    <>
      <circle cx={8} cy={5.25} r={2.75} />
      <path d="M2.75 14c.4-2.75 2.6-4.5 5.25-4.5s4.85 1.75 5.25 4.5" />
    </>
  ),
  pencil: <path d="M10.6 2.4a1.8 1.8 0 0 1 2.55 2.55L5.3 12.8l-3.3.85.85-3.3z" />,
  state: (
    <>
      <circle cx={8} cy={8} r={6.25} />
      <circle cx={8} cy={8} r={1.25} fill="currentColor" stroke="none" />
    </>
  ),
  milestone: <path d="M3 14.25V2.25M3 2.75h8.5l-2 3 2 3H3" />,
} as const satisfies Record<string, ReactNode>;
