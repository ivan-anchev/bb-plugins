// The hairlines that hang a sub-issue from its parent: Activity Sidebar's subthread rails
// (src/ui/card/subthread-section.tsx Rails), copied since plugins cannot import each other. A trunk
// comes down to the sub-issue's line (from above the first, its parent), bends into it, radius 4,
// and runs on past it unless it is the last. The board's rows and the hover card's lines draw the
// same rails at their own sizes.
import "./rails.css";

/** Where a tree's rails run: its lines' height, the trunk's x (a 1px line centred on it), and where the elbow ends, short of the line's glyph. */
export type RailShape = { line: number; trunk: number; tip: number };

type RailsProps = {
  shape: RailShape;
  /** How far the trunk reaches up above this line: for the first, up to its parent; else none. */
  reach: number;
  last: boolean;
};

export function Rails({ shape: { line, trunk, tip }, reach, last }: RailsProps) {
  const mid = line / 2;
  let d = `M${trunk} ${-reach}V${mid - BEND}A${BEND} ${BEND} 0 0 0 ${trunk + BEND} ${mid}H${tip}`;
  if (!last) d += `M${trunk} ${mid - BEND}V${line}`;
  return (
    <svg className="rmi-rails" width={tip + 1} height={line} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** The elbow's radius. */
const BEND = 4;
