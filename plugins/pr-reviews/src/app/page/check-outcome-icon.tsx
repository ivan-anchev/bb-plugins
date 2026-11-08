// A check outcome's glyph, for the side panel's check rows.
import type { CheckOutcome } from "../../contract.ts";
import { StatusGlyph, type StatusGlyphName } from "./status-glyph.tsx";

const OUTCOME_GLYPHS = {
  failing: "failed",
  pending: "running",
  passing: "passed",
} as const satisfies Record<CheckOutcome, StatusGlyphName>;

/** Decorative: the text beside it carries the outcome. */
export function CheckOutcomeIcon({ outcome }: { outcome: CheckOutcome }) {
  return <StatusGlyph name={OUTCOME_GLYPHS[outcome]} />;
}
