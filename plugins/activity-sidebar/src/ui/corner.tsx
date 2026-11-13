import type { Corner as CornerModel } from "../model/activity.ts";
import { StateGlyph } from "./state-glyph.tsx";

/**
 * The row's trailing box: its state, else its time. While bb's jump modifier is held, the jump key
 * shows in the same place, with what rests there kept unseen so the row doesn't reflow.
 */
export function Corner({ corner, jump }: { corner: CornerModel; jump: string | null }) {
  return (
    <span className="as-corner" data-jump={jump === null ? undefined : ""} aria-hidden>
      <span className="as-rest">{corner.kind === "state" ? <StateGlyph state={corner.state} /> : <span className="as-hint">{corner.text}</span>}</span>
      {jump !== null && <span className="as-jump as-hint">{jump}</span>}
    </span>
  );
}
