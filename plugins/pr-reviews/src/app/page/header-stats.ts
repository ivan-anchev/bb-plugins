// What the PR header's stats say, apart from how they look: GitHub's five-block diffstat.

export type DiffBlock = "added" | "removed" | "empty";

const DIFF_BLOCKS = 5;

/** Five blocks split between added and removed lines in proportion; a PR with no lines has five empty ones. */
export function diffBlocks(additions: number, deletions: number): DiffBlock[] {
  const total = additions + deletions;
  if (total === 0) return Array<DiffBlock>(DIFF_BLOCKS).fill("empty");
  const added = Math.round((additions / total) * DIFF_BLOCKS);
  return [...Array<DiffBlock>(added).fill("added"), ...Array<DiffBlock>(DIFF_BLOCKS - added).fill("removed")];
}
