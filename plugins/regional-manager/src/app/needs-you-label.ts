// What the rail badge says: how many issues wait for the user, summed over every listed regional manager's board.
import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";

/** The badge for these boards' counts of issues under Needs you; null when none waits. why critical: bb's tone for what waits on the user. */
export function needsYouBadge(boards: readonly number[]): ExperimentalBadge | null {
  const count = boards.reduce((sum, issues) => sum + issues, 0);
  if (count === 0) return null;
  return { count, tone: "critical", label: `${count} ${count === 1 ? "issue needs" : "issues need"} you` };
}
