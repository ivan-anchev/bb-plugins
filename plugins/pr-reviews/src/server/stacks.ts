// Stacked PRs: a PR whose base branch is another PR's head branch, in the same repo, sits on that
// PR. Pure.
import type { InboxPr, PrState } from "../contract.ts";

type StackPr = Pick<InboxPr, "repo" | "number" | "state" | "baseRefName" | "headRefName">;

// When a head branch was reused, the open PR on it is the one a PR above builds on now.
const HEAD_OWNER_RANK = { OPEN: 0, DRAFT: 0, MERGED: 1, CLOSED: 2 } as const satisfies Record<PrState, number>;

/**
 * Every stack among `prs`: two or more PRs, bottom first. A PR follows the one it sits on, and
 * the PRs that sit on the same one follow it in number order, each with the PRs above it, so the
 * bottom is the PR the others build on and a PR comes after its own base. A PR on no other and
 * under none is in no stack.
 */
export function buildStacks<P extends StackPr>(prs: P[]): P[][] {
  const byHead = new Map<string, P>();
  for (const pr of [...prs].sort((a, b) => HEAD_OWNER_RANK[a.state] - HEAD_OWNER_RANK[b.state])) {
    const key = branchKey(pr.repo, pr.headRefName);
    if (!byHead.has(key)) byHead.set(key, pr);
  }

  const above = new Map<P, P[]>();
  const roots: P[] = [];
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    const below = byHead.get(branchKey(pr.repo, pr.baseRefName));
    if (below === undefined || below === pr) roots.push(pr);
    else above.set(below, [...(above.get(below) ?? []), pr]);
  }

  const upFrom = (pr: P): P[] => [pr, ...(above.get(pr) ?? []).flatMap(upFrom)];
  return roots.filter((root) => above.has(root)).map(upFrom);
}

const branchKey = (repo: string, branch: string) => `${repo}:${branch}`;
