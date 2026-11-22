import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";
import type { NeedsYou } from "../model/board/board-groups.ts";

/** The badge for these boards' Needs you; null when nothing waits. why critical: bb's tone for what waits on the user. */
export function needsYouBadge(boards: readonly NeedsYou[]): ExperimentalBadge | null {
  const decisions = boards.reduce((sum, board) => sum + board.decisions, 0);
  const issues = boards.reduce((sum, board) => sum + board.issues, 0);
  const count = decisions + issues;
  if (count === 0) return null;
  const what = [counted(decisions, "decision"), counted(issues, "issue")].filter((part) => part !== null).join(", ");
  return { count, tone: "critical", label: `${count} ${count === 1 ? "needs" : "need"} you: ${what}` };
}

const counted = (count: number, noun: string): string | null => (count === 0 ? null : `${count} ${noun}${count === 1 ? "" : "s"}`);
