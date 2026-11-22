// A reviewer thread's first message: the plugin's one line of its own (review this diff as CREW.md
// instructs reviewers, and report through issue_review), the diff an agent handed off as done, the
// issue's brief and done-criteria, and CREW.md whole, as agents get it. What the reviewer runs is
// CREW.md's: the plugin names no review of its own. Like a verifier's, it holds only the regional
// manager's words, commit ids and bb's facts, never an agent's report.
import type { Issue } from "../../model/issue/issue.ts";
import type { MemoryText } from "../../model/memory-file.ts";
import type { HandoffCheck } from "../../model/verdict/check.ts";
import { crewSection } from "../agents/brief.ts";
import { REVIEW } from "./review-tool.ts";

/** The diff to review: the claimed commit, the pull request the agent named (null: none), and the branch it is reviewed against (null: bb records no default branch). */
type Diff = Pick<HandoffCheck["subject"], "headSha" | "prUrl"> & { defaultBranch: string | null };

export function reviewerBrief(issue: Pick<Issue, "id" | "title" | "doneCriteria"> & { brief: string }, diff: Diff, crewRules: MemoryText | null): string {
  return [
    `# Review ${issue.id}: ${issue.title}`,
    `Review this diff as CREW.md instructs reviewers, and report through ${REVIEW}.`,
    `## The diff\n\n${diffText(diff)}`,
    `## The issue's brief\n\n${issue.brief.trim()}`,
    `## Done-criteria\n\n${issue.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    crewSection(crewRules),
  ].join("\n\n");
}

/** Where the diff is: the claimed commit against the default branch, in this environment, and its pull request when the agent named one. */
function diffText({ headSha, prUrl, defaultBranch }: Diff): string {
  const against = defaultBranch === null ? "the default branch" : `\`origin/${defaultBranch}\``;
  const command = defaultBranch === null ? "" : ` (\`git diff origin/${defaultBranch}...${headSha}\`)`;
  const pull = prUrl === null ? "" : ` Its pull request: ${prUrl}.`;
  return `The commits up to \`${headSha}\`, checked out in this environment, that ${against} doesn't have${command}.${pull}`;
}
