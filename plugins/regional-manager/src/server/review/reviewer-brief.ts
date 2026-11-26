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
import { ANCHOR_RULE, findingText, MISSED_RULE, numberedText } from "../../model/verdict/review.ts";
import { crewSection } from "../agents/brief.ts";
import { decisionsPart, type Scope } from "./checker-brief.ts";
import { REVIEW } from "./review-tool.ts";

/** The diff to review: the claimed commit, the pull request the agent named (null: none), and the branch it is reviewed against (null: bb records no default branch). */
export type Diff = Pick<HandoffCheck["subject"], "headSha" | "prUrl"> & { defaultBranch: string | null };

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
    `Review this diff as CREW.md instructs reviewers, and report through ${REVIEW}. CREW.md says what to look for; this rule alone says what blocks. ${ANCHOR_RULE} Report each finding at the severity CREW.md gives it: the verifier anchors or downgrades a must-fix, never you. For a must-fix, say in its claim which anchor it meets, with the normal-use steps that reach it when it is a bug, or that it meets none.`,
    ...scopeParts(diff, scope),
    `## The issue's brief\n\n${issue.brief.trim()}`,
    `## Done-criteria\n\n${issue.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    ...decisionsPart(issue.id, issue.decisions),
    crewSection(crewRules),
  ].join("\n\n");
}

/**
 * What the reviewer reviews, as its first message gives it: the whole diff on a first round; after
 * a reviewed round, only the change since, with that round's blocking findings, the known ones and
 * how to mark its own. issue_review gives the same to a reviewer whose first message predates it.
 */
export const scopeParts = (diff: Diff, scope: Scope): string[] =>
  scope.kind === "first" ? [`## The diff\n\n${wholeDiffText(diff)}`] : [`## The diff\n\n${deltaText(diff, scope)}`, ...laterRoundParts(scope)];

/** Where the diff is: the claimed commit against the default branch, in this environment, and its pull request when the agent named one. */
function wholeDiffText({ headSha, prUrl, defaultBranch }: Diff): string {
  const against = defaultBranch === null ? "the default branch" : `\`origin/${defaultBranch}\``;
  return `The commits up to \`${headSha}\`, checked out in this environment, that ${against} doesn't have${wholeCommand(headSha, defaultBranch)}.${pullText(prUrl)}`;
}

/**
 * A later round's diff: only the change since round `round`'s commit, in the files this branch
 * changes now or changed at that round, leaving out only the default branch's net change between
 * the two rounds' merge bases; every other change is the branch's own, a removal of its own
 * earlier addition included. And what to do when that commit isn't in this environment, as after a
 * handover to a new branch. Each ref and revision is shell-quoted where it needs it (shellArg).
 */
function deltaText({ headSha, prUrl, defaultBranch }: Diff, { round, base }: After): string {
  const baseSha = base.subject.headSha;
  const [b, h] = [shellArg(baseSha), shellArg(headSha)];
  return [
    `Round ${round} was the last round reviewed, at \`${baseSha}\`. Review only what changed since then, up to \`${headSha}\`, checked out in this environment: \`git diff ${b} ${h}\`, limited to ${filesText(b, h, defaultBranch, round)}.${pullText(prUrl)}`,
    upstreamText(b, h, defaultBranch, round),
    `If \`git cat-file -e ${b}\` fails, that commit isn't in this environment: review the whole diff instead${wholeCommand(headSha, defaultBranch)}, mark every finding new, and still answer each of round ${round}'s blocking findings below.`,
  ].join("\n\n");
}

/**
 * The files a later round reviews: those the branch changes now and those it changed at the
 * reviewed round. why both: a file the branch has since put back as the default branch has it
 * leaves the first list, and putting it back is the branch's change.
 */
function filesText(b: string, h: string, defaultBranch: string | null, round: number): string {
  if (defaultBranch === null) return `the files this branch changes against the default branch, now or at round ${round}`;
  const d = shellArg(`origin/${defaultBranch}`);
  return `the files this branch changes: those \`git diff ${d}...${h} --stat\` lists now, and those \`git diff ${d}...${b} --stat\` lists for round ${round}, as a file the branch has since put back as the default branch has it is still the branch's change`;
}

/**
 * How a later round's reviewer leaves out what the default branch changed: by its net change
 * between the points the branch was based on at the two rounds (their merge bases), never by its
 * commits one by one, so a line the default branch added and took back again leaves out nothing.
 */
function upstreamText(b: string, h: string, defaultBranch: string | null, round: number): string {
  const own = "Review every other change, as the branch's own, a removal of something the branch added before included.";
  if (defaultBranch === null) return `A file this branch changes can also hold what the default branch changed since round ${round}, merged in. Leave out only a change the default branch's net change since then also makes. ${own}`;
  const d = shellArg(`origin/${defaultBranch}`);
  return `A file this branch changes can also hold what the default branch changed since round ${round}, merged in. Its net change across the two rounds is \`git diff $(git merge-base ${b} ${d}) $(git merge-base ${h} ${d}) -- <file>\`. Leave out of \`git diff ${b} ${h} -- <file>\` only a change that net change also makes. ${own}`;
}

/** What a later round's reviewer answers and marks: the earlier round's blocking findings, numbered, the findings already known, and how to mark its own. */
function laterRoundParts({ round, blocking, known }: After): string[] {
  const answer =
    blocking.length === 0
      ? `None of round ${round}'s findings failed its verdict: pass earlier as [].`
      : `Each of these failed round ${round}'s verdict. Answer every one in ${REVIEW}'s earlier, by its number: fixed or not, with a note on what you saw. One not fixed goes to the verifier again, as unfixed; don't report it again as a finding.\n\n${numberedText(blocking)}`;
  return [
    `## Round ${round}'s blocking findings\n\n${answer}`,
    ...(known.length === 0 ? [] : [`## Findings already known\n\nEarlier rounds' findings that held without blocking. Don't report them again: they don't go back to the agent, and when the issue passes they are filed as a follow-up, unless every one is a nit.\n\n${known.map((finding) => `- ${findingText(finding, "  ")}`).join("\n")}`]),
    `## Marking your findings\n\nMark each finding you report with its origin: new, on code changed since round ${round}'s commit, or missed, on code round ${round} reviewed unchanged. ${MISSED_RULE} Report a missed one at the severity CREW.md gives it all the same.`,
  ];
}

/** The command for the whole diff, as a parenthesis; nothing when bb records no default branch. */
const wholeCommand = (headSha: string, defaultBranch: string | null): string => (defaultBranch === null ? "" : ` (\`git diff ${shellArg(`origin/${defaultBranch}`)}...${shellArg(headSha)}\`)`);

/** A ref or revision as one shell word: as it is when it holds only characters a shell leaves alone, else single-quoted. */
const shellArg = (arg: string): string => (/^[\w./@^~:-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

const pullText = (prUrl: string | null): string => (prUrl === null ? "" : ` Its pull request: ${prUrl}.`);
