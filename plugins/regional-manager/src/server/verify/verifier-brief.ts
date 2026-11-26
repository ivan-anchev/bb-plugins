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
import { ANCHOR_RULE, defectText, findingText, MISSED_RULE, numberedText, RECHECK_RULE, TRIAGE_RULE, type BlockingDefect, type Review } from "../../model/verdict/review.ts";
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

/**
 * A handoff's verifier's: the commit the agent claims, in the agent's own environment, with what its
 * review covered (`scope`), the blocking defects an earlier verifier found (`earlier`), and the
 * issue's decisions as they stand as it starts.
 */
export function verifierBrief(
  issue: Pick<Issue, "id" | "title"> & { brief: string; decisions: readonly IssueDecision[] },
  check: Pick<HandoffCheck, "criteria" | "subject" | "review">,
  checkout: Checkout,
  scope: Scope,
  earlier: readonly BlockingDefect[],
): string {
  const { agentId, headSha } = check.subject;
  return [
    `# Verify ${issue.id}: ${issue.title}`,
    `Agent ${agentId} says its work on ${issue.id} is done at commit ${headSha}, in this environment. Check every done-criterion yourself, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree, as the plugin read them\n\n${checkoutText(headSha, checkout)} ${checkoutNote(agentId, headSha, checkout)}`,
    criteriaPart(check.criteria),
    ...reviewPart(check.review, scope),
    ...earlierPart(earlier),
    `## The issue's brief, for context\n\n${issue.brief.trim()}`,
    ...decisionsPart(issue.id, issue.decisions),
    `## Rules\n\nRun whatever proves or disproves each criterion, and quote what it printed. ${UNCHECKABLE_RULE} ${ALONE_RULE} Never edit, commit, push or check out anything: you share ${agentId}'s working tree.`,
    `## What blocks\n\nThe anchor rule: ${ANCHOR_RULE}\n\n${QA_RULE}`,
  ].join("\n\n");
}

/**
 * What a defect a verifier finds itself outside the done-criteria does, as when creed-qa's checks of
 * the surrounding code turn one up (CREW.md's Verifiers section): one that meets a blocking anchor
 * goes in issue_verdict's blocking, and fails the verdict (verdict.ts failureReasons); any other
 * goes in its findings, which never do.
 */
export const QA_RULE =
  "When you run creed-qa, a defect its checks of the surrounding code turn up outside the done-criteria fails the verdict only if it meets a blocking anchor. Report one that does in issue_verdict's blocking, with its anchor and, for a bug, the normal-use steps that reach it: each one fails the verdict, as a failed criterion does. Report every other one in findings, with the severity CREW.md's Reviewers section gives it: findings never fail the verdict. A defect that meets no anchor, as a REVIEW.md or principle violation or a bug that needs a contrived setup, never fails a criterion and never makes your verdict NOT_VERIFIED.";

/**
 * A final check's verifier's: the parent's own criteria, on the default branch as origin has it,
 * in a fresh worktree of its own, with the blocking defects an earlier final check's verifier
 * found (`earlier`), and the parent's brief, if it has one, and its decisions as they stand as it
 * starts, against which a carried requirement is rechecked. No commit is named: the plugin reads
 * the worktree as the verifier returns, and judges the commit it holds then.
 */
export function finalCheckBrief(
  issue: Pick<Issue, "id" | "title" | "description" | "brief"> & { decisions: readonly IssueDecision[] },
  check: Pick<FinalCheck, "criteria" | "subject">,
  earlier: readonly BlockingDefect[],
): string {
  const { defaultBranch, merged } = check.subject;
  return [
    `# Final check of ${issue.id}: ${issue.title}`,
    `Every sub-issue of ${issue.id} is closed, and the work of ${merged.join(", ")} is merged on ${defaultBranch}. This environment is a fresh worktree of ${defaultBranch} as origin has it, made for you alone. Check every done-criterion of ${issue.id} yourself on it, as it is, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree\n\nNo commit is named. When you call issue_verdict, the plugin reads this worktree through bb's git plugin and judges the commit it holds then, on a clean tree: a file changed or added there that git shows fails the verdict, whatever you find. Don't check the commit or the tree yourself, and don't fail a criterion over them.`,
    criteriaPart(check.criteria),
    ...earlierPart(earlier),
    `## ${issue.id}, for context\n\n${issue.description.trim()}`,
    ...(issue.brief === null ? [] : [`## ${issue.id}'s brief, for context\n\n${issue.brief.trim()}`]),
    ...decisionsPart(issue.id, issue.decisions),
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
        `## Round ${scope.round}'s blocking findings\n\nNo review was had: ${review.reason}. So each finding that failed round ${scope.round}'s verdict stands as unfixed until you check it here: triage every one in issue_verdict by its number. ${TRIAGE_RULE}\n\n${numberedText(list)}`,
      ];
    case "reported":
      if (list.length === 0) return [`## The review\n\n${coveredText(scope, "found nothing")} There is nothing to triage: pass triage as [].${fixedPart(review, scope)}`];
      return [
        `## The reviewer's findings\n\n${coveredText(scope, "claims these")} They are claims, not facts: check each one yourself here, and triage every one in issue_verdict by its number. It reviewed as the regional manager's CREW.md instructs reviewers: read CREW.md with crew_memory_read when a finding cites it. ${TRIAGE_RULE}${originsText(scope)}\n\n${numberedText(list)}${fixedPart(review, scope)}`,
      ];
    default:
      return review satisfies never;
  }
}

/**
 * What the reviewer was asked to read, and what it reported (`reported`, "claims these"): the whole
 * diff on a first round; after a reviewed round, only the change since its commit, or the whole diff
 * when that commit isn't in this environment. why both, unsaid which: the plugin doesn't see which
 * the reviewer ran.
 */
function coveredText(scope: Scope, reported: string): string {
  if (scope.kind === "first") return `An independent reviewer read the diff before you and ${reported}.`;
  return `An independent reviewer read the diff before you and ${reported}. It was asked to review only the change since round ${scope.round}, the last round reviewed, at \`${scope.base.subject.headSha}\`, in the files this branch changes; or, when that commit isn't in this environment, the whole diff, marking every finding new.`;
}

/** After a reviewed round, what each finding's origin means; nothing on a first round, whose findings are all new. */
const originsText = (scope: Scope): string =>
  scope.kind === "first"
    ? ""
    : ` A finding marked unfixed is one of round ${scope.round}'s blocking findings the reviewer says this diff doesn't fix; one marked missed sits on code round ${scope.round} reviewed unchanged; every other one is new, on code changed since, or anywhere when it reviewed the whole diff. ${MISSED_RULE}`;

/** After a reviewed round, the blocking findings the reviewer answered fixed, with its note, as context: they are not triaged. */
function fixedPart(review: Extract<Review, { state: "reported" }>, scope: Scope): string {
  if (scope.kind === "first") return "";
  const fixed = review.earlier.flatMap(({ fixed, note }, i) => {
    const finding = scope.blocking[i];
    // why throw: issue_review stores one answer per blocking finding, in their order (review.ts reportOf).
    if (finding === undefined) throw new Error(`Round ${scope.round} has no blocking finding ${i + 1} to answer.`);
    return fixed ? [`- ${findingText(finding, "  ")}\n  The reviewer: ${note}`] : [];
  });
  return fixed.length === 0 ? "" : `\n\nRound ${scope.round}'s blocking findings the reviewer answered fixed, for context; they are not yours to triage:\n\n${fixed.join("\n")}`;
}

/** The blocking defects an earlier verifier found, numbered as issue_verdict's earlierDefects takes them; nothing when there are none. */
function earlierPart(earlier: readonly BlockingDefect[]): string[] {
  if (earlier.length === 0) return [];
  const list = earlier.map((defect, i) => `${i + 1}. ${defectText(defect, "   ")}`).join("\n");
  return [
    `## Blocking defects an earlier verifier found\n\nAn earlier verifier of this issue found these itself, outside the done-criteria, and each failed its verdict. Answer every one in issue_verdict's earlierDefects by its number. ${RECHECK_RULE} One you answer not fixed stays blocking, and fails this verdict too.\n\n${list}`,
  ];
}

const criteriaPart = (criteria: readonly string[]): string => `## Done-criteria\n\n${criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`;

/** What the verifier does with the plugin's read: never judge it again, and check every criterion either way. */
function checkoutNote(agentId: AgentId, claimed: string, checkout: Checkout): string {
  const own = `The plugin judges the commit and the tree itself, from this read: don't check them, and don't fail a criterion over them. Your shell may show files ${agentId}'s tree doesn't have.`;
  return checkoutProblems(claimed, checkout).length === 0 ? own : `${own} This already fails the verdict, whatever you find; check every criterion anyway, so ${agentId} learns all there is to fix at once.`;
}
