// A check outcome's glyph, shared by the header's checks verdict and the side panel's check rows.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { CheckOutcome } from "../../contract.ts";

const OUTCOME_ICONS = {
  failing: { name: "CircleX", color: "text-destructive-text" },
  pending: { name: "Clock", color: "text-muted-foreground" },
  passing: { name: "CircleCheck", color: "text-success-foreground" },
} as const satisfies Record<CheckOutcome, { name: string; color: string }>;

/** Decorative: the text beside it carries the outcome. */
export function CheckOutcomeIcon({ outcome }: { outcome: CheckOutcome }) {
  const icon = OUTCOME_ICONS[outcome];
  return <Icon name={icon.name} className={`size-3.5 shrink-0 ${icon.color}`} aria-hidden />;
}
