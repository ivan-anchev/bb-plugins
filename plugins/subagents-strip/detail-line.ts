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

function compactLabel(line: WorkItem): string {
  if (line.kind === "group") return line.label;
  const { step } = line;
  return step.kind === "work" && conceptOf(step) !== null ? groupLabel([step], line.live) : stepLabel(step);
}
