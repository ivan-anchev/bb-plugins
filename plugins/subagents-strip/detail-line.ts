// A row's second line. While a delegate runs it says what the trail's latest
// line says, in bb's compact words ("Running 7 commands, exploring 2 files"),
// never a raw command line; once it settles, how it ended.
import type { Delegate } from "./delegate.ts";
import { firstLine, stepLabel } from "./steps.ts";
import { trailItems, type WorkItem } from "./work-groups.ts";
import { conceptOf, groupLabel } from "./work-label.ts";

/** A row's second line: the trail's latest line while running, the outcome once settled. */
export function detailLine(d: Delegate): string {
  switch (d.state.status) {
    case "running": {
      const line = trailItems(d).at(-1);
      return line ? compactLabel(line) : "Starting…";
    }
    case "completed": return d.state.report ? firstLine(d.state.report) : "Finished without a report";
    case "failed": return d.state.error ? firstLine(d.state.error) : "Failed";
    case "stopped": return "Stopped";
  }
}

// ---------------------------------------------------------------- layer 2

/**
 * A group's own words. A lone step of work bb would fold, counted as bb counts a group ("Running 1
 * command"); a message, question, or approval, which bb never folds, as its own line says it.
 */
function compactLabel(line: WorkItem): string {
  if (line.kind === "group") return line.label;
  const { step } = line;
  return step.kind === "work" && conceptOf(step) !== null ? groupLabel([step], line.live) : stepLabel(step);
}
