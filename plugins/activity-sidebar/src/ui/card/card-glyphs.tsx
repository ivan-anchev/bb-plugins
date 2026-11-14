// The hover card's line glyphs, Zeron's own (Z:ds/icon_svgs.luau): bb's icon set lacks most of them,
// and the card's lines read as Zeron's only in its strokes. Drawn at 12 by app.css `.as-card-glyph`.
import type { ReactNode } from "react";

const PATHS = {
  // Z:ds/icon_svgs.luau:56
  clock: (
    <g strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" />
    </g>
  ),
  // Z:ds/icon_svgs.luau:105
  laptop: (
    <g strokeWidth={1.5} strokeLinecap="round">
      <path d="M19.647 15.536H4.353m15.294 0V8c0-1.886 0-2.828-.586-3.414C18.476 4 17.533 4 15.647 4H8.353c-1.886 0-2.828 0-3.414.586S4.353 6.114 4.353 8v7.536m15.294 0l1.744 1.8l.088.092a2 2 0 0 1 .52 1.284l.001.127c0 .15 0 .224-.004.287a2 2 0 0 1-1.87 1.87a5 5 0 0 1-.287.004H4.161c-.15 0-.224 0-.287-.004a2 2 0 0 1-1.87-1.87C2 19.063 2 18.988 2 18.84l.001-.127a2 2 0 0 1 .52-1.284l.088-.092l1.744-1.8M9.5 18.5h5" />
      <path fill="currentColor" stroke="none" d="M12.75 6.75a.75.75 0 1 1-1.5 0a.75.75 0 0 1 1.5 0" />
    </g>
  ),
  // Z:ds/icon_svgs.luau:90
  folder: (
    <path strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" d="M3 7a3 3 0 0 1 3-3h2.6a2 2 0 0 1 1.6.8L12 7h6a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" />
  ),
  // Z:ds/icon_svgs.luau:93
  branch: (
    <g strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.5v7M6 12h10a2 2 0 0 0 2-2V8.5" />
      <circle cx="6" cy="6.25" r="2.25" />
      <circle cx="6" cy="17.75" r="2.25" />
      <circle cx="18" cy="6.25" r="2.25" />
    </g>
  ),
  // Z:ds/icon_svgs.luau:54
  checklist: (
    <g strokeWidth={1.5} strokeLinecap="round">
      <path strokeLinejoin="round" d="M2 5.5L3.214 7L7.5 3M2 12.5L3.214 14L7.5 10M2 19.5L3.214 21L7.5 17" />
      <path d="M22 19H12m10-7H12m10-7H12" />
    </g>
  ),
  // why: Zeron has no Subthreads heading. The prototype borrowed its side-chat glyph (Z:ds/icon_svgs.luau:155),
  // which draws a pointer arrow; a trunk with two branches says "threads under this one", as the tree below it does.
  subthreads: (
    <path strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" d="M21 12h-8M21 6H8M21 18h-8M3 6v4a2 2 0 0 0 2 2h3M3 10v6a2 2 0 0 0 2 2h3" />
  ),
} satisfies Record<string, ReactNode>;

export type CardGlyphName = keyof typeof PATHS;

export function CardGlyph({ name }: { name: CardGlyphName }) {
  return (
    <svg className="as-card-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
