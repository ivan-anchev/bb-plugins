// A finding's mark: a small square in the colour of what it does to the work (round.ts Effect), red
// when it blocks the work, amber when it goes to the follow-up, grey for a nit, an outline when
// rejected; before its triage, in its severity's colour. Its label names both, for screen readers.
import type { Effect } from "../../../../../../model/feed/round.ts";
import type { Severity } from "../../../../../../model/verdict/review.ts";

/** `effect`: null before the verifier triaged it. */
export function Mark({ severity, effect }: { severity: Severity; effect: Effect | null }) {
  return <span className="rmi-mark" data-severity={severity} data-effect={effect ?? undefined} role="img" aria-label={`${severity}: ${effectText(effect)}`} />;
}

/** What a finding does to the work, in words: "blocks the work", "goes to the follow-up". */
function effectText(effect: Effect | null): string {
  switch (effect) {
    case null:
      return "not triaged yet";
    case "blocks":
      return "blocks the work";
    case "follow-up":
      return "goes to the follow-up";
    case "nit":
      return "held as a nit";
    case "rejected":
      return "rejected";
    default:
      // why plain words: the server may be newer than this bundle for a moment after an update.
      effect satisfies never;
      return "triaged";
  }
}
