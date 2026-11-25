// A reviewer thread's first message: the plugin's lines of its own (review this diff as CREW.md
// instructs reviewers, and report through issue_review; CREW.md says what to look for, and the
// anchor rule alone what blocks), the diff an agent handed off as done, the issue's brief,
// done-criteria and decisions, and CREW.md whole, as agents get it. What the reviewer runs is
// CREW.md's: the plugin names no review of its own. Like a verifier's, it holds only the regional
// manager's words, commit ids and bb's facts, never an agent's report.
import type { IssueDecision } from "../../model/decision.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { MemoryText } from "../../model/memory-file.ts";
import type { HandoffCheck } from "../../model/verdict/check.ts";
import { ANCHOR_RULE, findingText, MISSED_RULE, type ReviewFinding } from "../../model/verdict/review.ts";
import { crewSection } from "../agents/brief.ts";
import { decisionsPart, type Scope } from "./checker-brief.ts";
import { REVIEW } from "./review-tool.ts";

/** The diff to review: the claimed commit, the pull request the agent named (null: none), and the branch it is reviewed against (null: bb records no default branch). */
type Diff = Pick<HandoffCheck["subject"], "headSha" | "prUrl"> & { defaultBranch: string | null };

/** A later round's scope. */
type After = Extract<Scope, { kind: "after" }>;

/** The reviewer's first message, with the issue's decisions as they stand as it starts: the whole diff on a first round; after a reviewed round, only the change since, with that round's findings. */
export function reviewerBrief(
  issue: Pick<Issue, "id" | "title" | "doneCriteria"> & { brief: string; decisions: readonly IssueDecision[] },
  diff: Diff,
  scope: Scope,
  crewRules: MemoryText | null,
): string {
  return [
    `# Review ${issue.id}: ${issue.title}`,
    `Review this diff as CREW.md instructs reviewers, and report through ${REVIEW}. CREW.md says what to look for; this rule alone says what blocks. ${ANCHOR_RULE} Report each finding at the severity CREW.md gives it, a must-fix that breaks none of the five included: the verifier anchors or downgrades it, never you. For a must-fix, say in its claim which of the five it breaks, or that it breaks none.`,
    `## The diff\n\n${scope.kind === "first" ? wholeDiffText(diff) : deltaText(diff, scope)}`,
    ...(scope.kind === "first" ? [] : laterRoundParts(scope)),
    `## The issue's brief\n\n${issue.brief.trim()}`,
    `## Done-criteria\n\n${issue.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    ...decisionsPart(issue.id, issue.decisions),
    crewSection(crewRules),
  ].join("\n\n");
}

/** Where the diff is: the claimed commit against the default branch, in this environment, and its pull request when the agent named one. */
function wholeDiffText({ headSha, prUrl, defaultBranch }: Diff): string {
  const against = defaultBranch === null ? "the default branch" : `\`origin/${defaultBranch}\``;
  return `The commits up to \`${headSha}\`, checked out in this environment, that ${against} doesn't have${wholeCommand(headSha, defaultBranch)}.${pullText(prUrl)}`;
}

/**
 * A later round's diff: only the change since round `round`'s commit, in the files this branch
 * changes, so commits merged in from the default branch are not reviewed; and what to do when that
 * commit isn't in this environment, as after a handover to a new branch.
 */
function deltaText({ headSha, prUrl, defaultBranch }: Diff, { round, base }: After): string {
  const baseSha = base.subject.headSha;
  const files =
    defaultBranch === null
      ? "the files this branch changes against the default branch"
      : `the files this branch changes (\`git diff origin/${defaultBranch}...${headSha} --stat\`)`;
  return [
    `Round ${round} was the last round reviewed, at \`${baseSha}\`. Review only what changed since then, up to \`${headSha}\`, checked out in this environment: \`git diff ${baseSha} ${headSha}\`, limited to ${files}, so commits merged in from the default branch are not reviewed.${pullText(prUrl)}`,
    `If \`git cat-file -e ${baseSha}\` fails, that commit isn't in this environment: review the whole diff instead${wholeCommand(headSha, defaultBranch)}, mark every finding new, and still answer each of round ${round}'s blocking findings below.`,
  ].join("\n\n");
}

/** What a later round's reviewer answers and marks: the earlier round's blocking findings, numbered, the findings already known, and how to mark its own. */
function laterRoundParts({ round, blocking, known }: After): string[] {
  const answer =
    blocking.length === 0
      ? `None of round ${round}'s findings failed its verdict: pass earlier as [].`
      : `Each of these failed round ${round}'s verdict. Answer every one in ${REVIEW}'s earlier, by its number: fixed or not, with a note on what you saw. One not fixed goes to the verifier again, as unfixed; don't report it again as a finding.\n\n${numbered(blocking)}`;
  return [
    `## Round ${round}'s blocking findings\n\n${answer}`,
    ...(known.length === 0 ? [] : [`## Findings already known\n\nEarlier rounds' findings that held. Don't report them again.\n\n${known.map((finding) => `- ${indented(finding, "  ")}`).join("\n")}`]),
    `## Marking your findings\n\nMark each finding you report with its origin: new, on code changed since round ${round}'s commit, or missed, on code round ${round} reviewed unchanged. ${MISSED_RULE} Report a missed one at the severity CREW.md gives it all the same.`,
  ];
}

/** The findings, numbered from 1 as the tool takes them. */
const numbered = (findings: readonly ReviewFinding[]): string => findings.map((finding, i) => `${i + 1}. ${indented(finding, "   ")}`).join("\n");

/** A finding in a line (review.ts findingText), its claim's later lines indented under it. */
const indented = (finding: ReviewFinding, indent: string): string => findingText(finding).replaceAll("\n", `\n${indent}`);

/** The command for the whole diff, as a parenthesis; nothing when bb records no default branch. */
const wholeCommand = (headSha: string, defaultBranch: string | null): string => (defaultBranch === null ? "" : ` (\`git diff origin/${defaultBranch}...${headSha}\`)`);

const pullText = (prUrl: string | null): string => (prUrl === null ? "" : ` Its pull request: ${prUrl}.`);
