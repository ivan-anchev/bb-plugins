// A card's quiet lines under its title, each a 12 glyph and its words: its state and since when first.
// The threads' card and the managers' say them alike.
import type { ReactNode } from "react";
import type { StateLine } from "../../card/state-line.ts";
import { sleepGlyph } from "../row/sleep-glyphs.tsx";
import { StateGlyph } from "../state-glyph.tsx";
import { CardGlyph } from "./card-glyphs.tsx";

/**
 * A line: a 12 glyph and its words, cut with "…" at the card's edge. `after` stays whole after them:
 * the branch gives way before where it runs, which is short and new.
 */
export function Line({ glyph, after = null, children }: { glyph: ReactNode; after?: ReactNode; children: ReactNode }) {
  return (
    <div className="as-card-line">
      <span className="as-card-g">{glyph}</span>
      <span className="as-card-t">{children}</span>
      {after !== null && <span className="as-card-after">{after}</span>}
    </div>
  );
}

/** "Working · for 4m", "Completed · 5m ago", or "5m ago", with its glyph. */
export function StateLineView({ line }: { line: StateLine }) {
  return (
    <Line glyph={stateGlyph(line)}>
      {line.lead}
      {line.note !== null && <i> · {line.note}</i>}
    </Line>
  );
}

// ------------------------------------------------------------------ layer 2

function stateGlyph(line: StateLine): ReactNode {
  switch (line.glyph.kind) {
    case "state":
      return <StateGlyph state={line.glyph.state} size={12} />;
    case "asleep":
      return sleepGlyph("Moon");
    case "clock":
      return <CardGlyph name="clock" />;
    default:
      line.glyph satisfies never;
      return null;
  }
}
