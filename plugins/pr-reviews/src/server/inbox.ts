// The sidebar's sections: the PRs the section searches found, each in a bb project with its repo,
// most recent first, with their stacks drawn from the found PRs and their stack-mates. Pure.
import { SECTION_KEYS, type GitHubProject, type InboxPr, type Section, type SectionItem, type SectionKey } from "../contract.ts";
import type { FoundPr, GitHubPr } from "../github/inbox-search.ts";
import { repoKey } from "../github/repo.ts";
import { buildStacks } from "./stacks.ts";

/**
 * GitHub's PRs as the sidebar lists them, each once: a found PR in its section, a stack-mate in
 * none. A PR opens in the first of `projects` with its repo, by bb's project order.
 */
export function inboxPrs(found: FoundPr[], stackMates: GitHubPr[], projects: GitHubProject[]): InboxPr[] {
  const projectOf = new Map<string, string>();
  for (const { repo, id } of projects) if (!projectOf.has(repoKey(repo))) projectOf.set(repoKey(repo), id);
  const listed = [...found, ...stackMates.map((pr) => ({ section: null, pr }))];

  const prs = new Map<string, InboxPr>();
  for (const { section, pr } of listed) {
    const key = `${pr.repo}#${pr.number}`;
    const projectId = projectOf.get(repoKey(pr.repo));
    // A search can return a PR of a repo that moved since bb read the remote: it opens nowhere.
    if (!prs.has(key) && projectId !== undefined) prs.set(key, { ...pr, projectId, section });
  }
  return [...prs.values()];
}

/** The sections, in order, from `prs`: each lists its own PRs, and a stack with two or more of them lists the whole stack. */
export function buildSections(prs: InboxPr[]): Section[] {
  const stackOf = new Map<InboxPr, InboxPr[]>();
  for (const stack of buildStacks(prs)) for (const pr of stack) stackOf.set(pr, stack);
  return SECTION_KEYS.map((key) => {
    const listed = prs.filter((pr) => pr.section === key).sort(byRecency);
    return { key, count: listed.length, items: itemsOf(listed, key, stackOf) };
  });
}

// A stack takes the place of its most recent PR in the section.
function itemsOf(listed: InboxPr[], key: SectionKey, stackOf: ReadonlyMap<InboxPr, InboxPr[]>): SectionItem[] {
  const placed = new Set<InboxPr[]>();
  return listed.flatMap((pr): SectionItem[] => {
    const stack = stackOf.get(pr);
    if (stack === undefined) return [{ kind: "pr", pr, stack: null }];
    if (placed.has(stack)) return [];
    placed.add(stack);
    const here = stack.filter((member) => member.section === key).length;
    return here === 1 ? [{ kind: "pr", pr, stack: { index: stack.indexOf(pr) + 1, size: stack.length } }] : [{ kind: "stack", members: stack }];
  });
}

// Merged PRs by when they merged, the rest by their last activity. GitHub's ISO times sort as text.
const byRecency = (a: InboxPr, b: InboxPr) => (b.mergedAt ?? b.updatedAt).localeCompare(a.mergedAt ?? a.updatedAt);
