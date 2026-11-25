// A card's tree line's hairlines (card/subthread-tree.ts `Rail`): outer trunks running on past it, its
// own trunk bending into it, and on below unless it is the last. The subthreads' tree and a manager's
// sub-issues hang on them.
import type { Rail } from "../../card/subthread-tree.ts";

const CH = 24; // a line's height
const BEND = 4; // the elbow's radius

/** The line's hairlines: outer trunks running on past it, its own trunk bending into it, and on below
 * unless it is the last. */
export function Rails({ rail }: { rail: Rail }) {
  const x = rail.at + 0.5;
  const mid = CH / 2;
  const tip = rail.indent + 2;
  let d = rail.through.map((tx) => `M${tx + 0.5} -2V${CH}`).join("");
  d += `M${x} -2V${mid - BEND}A${BEND} ${BEND} 0 0 0 ${x + BEND} ${mid}H${tip}`;
  if (!rail.last) d += `M${x} ${mid - BEND}V${CH}`;
  return (
    <svg className="as-mini-rails" width={tip + 1} height={CH} aria-hidden>
      <path d={d} />
    </svg>
  );
}
