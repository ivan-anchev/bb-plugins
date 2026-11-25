// A verifier thread's first message: what to check and where, the checkout as the plugin read it
// or will read it, each done-criterion, a handoff's findings to triage, each numbered as
// issue_verdict takes them, with what its review covered and each finding's origin, and the
// issue's decisions. Only the regional
// manager's words, commit ids and bb's read are in it, never an agent's report, so the verifier
// checks the work rather than an agent's account of it.
import type { AgentId } from "../../model/agent/agent.ts";
import type { IssueDecision } from "../../model/decision.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { FinalCheck, HandoffCheck } from "../../model/verdict/check.ts";
import { checkoutProblems, checkoutText, type Checkout } from "../../model/verdict/checkout.ts";
import { findingText, MISSED_RULE, TRIAGE_RULE, type Review, type ReviewFinding } from "../../model/verdict/review.ts";
import { triageList } from "../../model/verdict/rounds/delta.ts";
import { UNCHECKABLE_RULE } from "../../model/verdict/verdict.ts";
import { decisionsPart, type Scope } from "../review/checker-brief.ts";

/**
 * Every verifier works alone: nobody answers it, so whatever it asks a person is declined. why the
 * gh CLI: a connector or app (codex's GitHub one) can stop to ask a person to sign in, and bb gives
 * a plugin no way to start a thread without them.
 */
export const ALONE_RULE =
  "Nobody answers you: anything you ask a person, or ask them to approve, is declined at once. For GitHub use the `gh` CLI in the shell, never a connector or app.";

/** A handoff's verifier's: the commit the agent claims, in the agent's own environment, with what its review covered (`scope`) and the issue's decisions as they stand as it starts. */
export function verifierBrief(
  issue: Pick<Issue, "id" | "title"> & { brief: string; decisions: readonly IssueDecision[] },
  check: Pick<HandoffCheck, "criteria" | "subject" | "review">,
  checkout: Checkout,
  scope: Scope,
): string {
  const { agentId, headSha } = check.subject;
  return [
    `# Verify ${issue.id}: ${issue.title}`,
    `Agent ${agentId} says its work on ${issue.id} is done at commit ${headSha}, in this environment. Check every done-criterion yourself, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree, as the plugin read them\n\n${checkoutText(headSha, checkout)} ${checkoutNote(agentId, headSha, checkout)}`,
    criteriaPart(check.criteria),
    ...reviewPart(check.review, scope),
    `## The issue's brief, for context\n\n${issue.brief.trim()}`,
    ...decisionsPart(issue.id, issue.decisions),
    `## Rules\n\nRun whatever proves or disproves each criterion, and quote what it printed. ${UNCHECKABLE_RULE} ${ALONE_RULE} Never edit, commit, push or check out anything: you share ${agentId}'s working tree.`,
  ].join("\n\n");
}

/**
 * A final check's verifier's: the parent's own criteria, on the default branch as origin has it,
 * in a fresh worktree of its own. No commit is named: the plugin reads the worktree as the
 * verifier returns, and judges the commit it holds then.
 */
export function finalCheckBrief(issue: Pick<Issue, "id" | "title" | "description">, check: Pick<FinalCheck, "criteria" | "subject">): string {
  const { defaultBranch, merged } = check.subject;
  return [
    `# Final check of ${issue.id}: ${issue.title}`,
    `Every sub-issue of ${issue.id} is closed, and the work of ${merged.join(", ")} is merged on ${defaultBranch}. This environment is a fresh worktree of ${defaultBranch} as origin has it, made for you alone. Check every done-criterion of ${issue.id} yourself on it, as it is, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree\n\nNo commit is named. When you call issue_verdict, the plugin reads this worktree through bb's git plugin and judges the commit it holds then, on a clean tree: a file changed or added there that git shows fails the verdict, whatever you find. Don't check the commit or the tree yourself, and don't fail a criterion over them.`,
    criteriaPart(check.criteria),
    `## ${issue.id}, for context\n\n${issue.description.trim()}`,
    `## Rules\n\nRun whatever proves or disproves each criterion, and quote what it printed. ${UNCHECKABLE_RULE} ${ALONE_RULE} Never edit, commit, push or check out anything: judge the worktree as it is.`,
  ].join("\n\n");
}

/**
 * What the handoff's reviewer found, numbered as issue_verdict's triage takes them (rounds/delta.ts
 * triageList), with what it covered and each finding's origin; or that none was had and why, with,
 * after a reviewed round, that round's blocking findings to triage as unfixed. Nothing for a check
 * with no review stage. why throw while it is still to come: no verifier starts before its review
 * is in (verify.ts requestFor).
 */
function reviewPart(review: Review, scope: Scope): string[] {
  const list = triageList(review, scope);
  switch (review.state) {
    case "none":
      return [];
    case "queued":
    case "running":
      throw new Error("A verifier starts before its check's review is in.");
    case "missed":
      if (scope.kind === "first" || list.length === 0) return [`## The review\n\nNo review was had: ${review.reason}. There is nothing to triage: pass triage as [].`];
      return [
        `## Round ${scope.round}'s blocking findings\n\nNo review was had: ${review.reason}. So each finding that failed round ${scope.round}'s verdict stands as unfixed until you check it here: triage every one in issue_verdict by its number. ${TRIAGE_RULE}\n\n${numbered(list)}`,
      ];
    case "reported":
      if (list.length === 0) return [`## The review\n\n${coveredText(scope)} and found nothing. There is nothing to triage: pass triage as [].${fixedPart(review, scope)}`];
      return [
        `## The reviewer's findings\n\n${coveredText(scope)} and claims these. They are claims, not facts: check each one yourself here, and triage every one in issue_verdict by its number. It reviewed as the regional manager's CREW.md instructs reviewers: read CREW.md with crew_memory_read when a finding cites it. ${TRIAGE_RULE}${originsText(scope)}\n\n${numbered(list)}${fixedPart(review, scope)}`,
      ];
    default:
      return review satisfies never;
  }
}

/** What the reviewer read, as a sentence's start: the whole diff on a first round; after a reviewed round, only the change since its commit. */
function coveredText(scope: Scope): string {
  if (scope.kind === "first") return "An independent reviewer read the diff before you";
  return `An independent reviewer read only the change since round ${scope.round}, the last round reviewed, at \`${scope.base.subject.headSha}\`, in the files this branch changes,`;
}

/** After a reviewed round, what each finding's origin means; nothing on a first round, whose findings are all new. */
const originsText = (scope: Scope): string =>
  scope.kind === "first"
    ? ""
    : ` A finding marked unfixed is one of round ${scope.round}'s blocking findings the reviewer says this diff doesn't fix; one marked missed sits on code round ${scope.round} reviewed unchanged; every other one is new, on code changed since. ${MISSED_RULE}`;

/** After a reviewed round, the blocking findings the reviewer answered fixed, with its note, as context: they are not triaged. */
function fixedPart(review: Extract<Review, { state: "reported" }>, scope: Scope): string {
  if (scope.kind === "first") return "";
  const fixed = review.earlier.flatMap(({ fixed, note }, i) => {
    const finding = scope.blocking[i];
    // why throw: issue_review stores one answer per blocking finding, in their order (review.ts reportOf).
    if (finding === undefined) throw new Error(`Round ${scope.round} has no blocking finding ${i + 1} to answer.`);
    return fixed ? [`- ${findingText(finding).replaceAll("\n", "\n  ")}\n  The reviewer: ${note}`] : [];
  });
  return fixed.length === 0 ? "" : `\n\nRound ${scope.round}'s blocking findings the reviewer answered fixed, for context; they are not yours to triage:\n\n${fixed.join("\n")}`;
}

/** The findings, numbered from 1 as issue_verdict takes them, each in a line (review.ts findingText). */
const numbered = (findings: readonly ReviewFinding[]): string => findings.map((finding, i) => `${i + 1}. ${findingText(finding).replaceAll("\n", "\n   ")}`).join("\n");

const criteriaPart = (criteria: readonly string[]): string => `## Done-criteria\n\n${criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`;

/** What the verifier does with the plugin's read: never judge it again, and check every criterion either way. */
function checkoutNote(agentId: AgentId, claimed: string, checkout: Checkout): string {
  const own = `The plugin judges the commit and the tree itself, from this read: don't check them, and don't fail a criterion over them. Your shell may show files ${agentId}'s tree doesn't have.`;
  return checkoutProblems(claimed, checkout).length === 0 ? own : `${own} This already fails the verdict, whatever you find; check every criterion anyway, so ${agentId} learns all there is to fix at once.`;
}
