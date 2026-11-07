// What the PR header's stats say, apart from how they look: GitHub's five-block diffstat, and the
// checks verdict led by the worst outcome (failing, then pending, then passing).
import type { ChecksSummary } from "../../contract.ts";

export type DiffBlock = "added" | "removed" | "empty";

const DIFF_BLOCKS = 5;

/** Five blocks split between added and removed lines in proportion; a PR with no lines has five empty ones. */
export function diffBlocks(additions: number, deletions: number): DiffBlock[] {
  const total = additions + deletions;
  if (total === 0) return Array<DiffBlock>(DIFF_BLOCKS).fill("empty");
  const added = Math.round((additions / total) * DIFF_BLOCKS);
  return [...Array<DiffBlock>(added).fill("added"), ...Array<DiffBlock>(DIFF_BLOCKS - added).fill("removed")];
}

export type ChecksTone = "failing" | "pending" | "passing";

/** The worst outcome as the headline, then the rest; null when the PR has no checks. */
export type ChecksVerdict = { tone: ChecksTone; headline: string; rest: string[] };

export function checksVerdict({ passing, failing, pending }: ChecksSummary): ChecksVerdict | null {
  const total = passing + failing + pending;
  if (total === 0) return null;
  const passed = `${passing}/${total} passing`;
  if (failing > 0) return { tone: "failing", headline: countChecks(failing, "failing"), rest: pending > 0 ? [`${pending} pending`, passed] : [passed] };
  if (pending > 0) return { tone: "pending", headline: countChecks(pending, "pending"), rest: [passed] };
  return { tone: "passing", headline: `${passing}/${total} checks passing`, rest: [] };
}

const countChecks = (count: number, state: string) => `${count} ${count === 1 ? "check" : "checks"} ${state}`;
