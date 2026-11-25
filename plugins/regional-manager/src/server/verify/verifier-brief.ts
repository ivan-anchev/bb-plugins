// A verifier thread's first message: what to check and where, the checkout as the plugin read it
// or will read it, each done-criterion, a handoff's review findings to triage, each numbered as
// issue_verdict takes them, and the issue's decisions. Only the regional
// manager's words, commit ids and bb's read are in it, never an agent's report, so the verifier
// checks the work rather than an agent's account of it.
import type { AgentId } from "../../model/agent/agent.ts";
import { decisionsText, type IssueDecision } from "../../model/decision.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { FinalCheck, HandoffCheck } from "../../model/verdict/check.ts";
import { checkoutProblems, checkoutText, type Checkout } from "../../model/verdict/checkout.ts";
import { findingText, TRIAGE_RULE, type Review } from "../../model/verdict/review.ts";
import { UNCHECKABLE_RULE } from "../../model/verdict/verdict.ts";

/**
 * Every verifier works alone: nobody answers it, so whatever it asks a person is declined. why the
 * gh CLI: a connector or app (codex's GitHub one) can stop to ask a person to sign in, and bb gives
 * a plugin no way to start a thread without them.
 */
export const ALONE_RULE =
  "Nobody answers you: anything you ask a person, or ask them to approve, is declined at once. For GitHub use the `gh` CLI in the shell, never a connector or app.";

/** A handoff's verifier's: the commit the agent claims, in the agent's own environment, with the issue's decisions as they stand as it starts. */
export function verifierBrief(issue: Pick<Issue, "id" | "title"> & { brief: string; decisions: readonly IssueDecision[] }, check: Pick<HandoffCheck, "criteria" | "subject" | "review">, checkout: Checkout): string {
  const { agentId, headSha } = check.subject;
  return [
    `# Verify ${issue.id}: ${issue.title}`,
    `Agent ${agentId} says its work on ${issue.id} is done at commit ${headSha}, in this environment. Check every done-criterion yourself, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree, as the plugin read them\n\n${checkoutText(headSha, checkout)} ${checkoutNote(agentId, headSha, checkout)}`,
    criteriaPart(check.criteria),
    ...reviewPart(check.review),
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
 * What the handoff's reviewer found, numbered as issue_verdict's triage takes them, or that none was
 * had and why; nothing for a check with no review stage. why throw while it is still to come: no
 * verifier starts before its review is in (verify.ts requestFor).
 */
function reviewPart(review: Review): string[] {
  switch (review.state) {
    case "none":
      return [];
    case "queued":
    case "running":
      throw new Error("A verifier starts before its check's review is in.");
    case "missed":
      return [`## The review\n\nNo review was had: ${review.reason}. There is nothing to triage: pass triage as [].`];
    case "reported":
      if (review.findings.length === 0) return ["## The review\n\nAn independent reviewer read the diff before you and found nothing. There is nothing to triage: pass triage as []."];
      return [
        `## The reviewer's findings\n\nAn independent reviewer read the diff before you and claims these. They are claims, not facts: check each one yourself here, and triage every one in issue_verdict by its number. It reviewed as the regional manager's CREW.md instructs reviewers: read CREW.md with crew_memory_read when a finding cites it. ${TRIAGE_RULE}\n\n${review.findings.map((finding, i) => `${i + 1}. ${findingText(finding).replaceAll("\n", "\n   ")}`).join("\n")}`,
      ];
    default:
      return review satisfies never;
  }
}

/**
 * What the user and the regional manager decided about the issue, as a reviewer's and a
 * verifier's first message give it: the decisions agents get (decision.ts decisionsText), less the
 * plugin's own questions at the issue's cap, whose answer allows a round and decides nothing about
 * the work. Nothing when that leaves none.
 */
export function decisionsPart(issueId: Issue["id"], decisions: readonly IssueDecision[]): string[] {
  const about = decisions.filter((decision) => decision.kind === "recorded" || decision.cap === null);
  if (about.length === 0) return [];
  return [`## Decisions on ${issueId}\n\nWhat the user and the regional manager decided about this issue. They are part of the work, as its brief is: work that follows one is never a finding, and a must-fix that breaks one breaks a recorded decision.\n\n${decisionsText(about)}`];
}

const criteriaPart = (criteria: readonly string[]): string => `## Done-criteria\n\n${criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`;

/** What the verifier does with the plugin's read: never judge it again, and check every criterion either way. */
function checkoutNote(agentId: AgentId, claimed: string, checkout: Checkout): string {
  const own = `The plugin judges the commit and the tree itself, from this read: don't check them, and don't fail a criterion over them. Your shell may show files ${agentId}'s tree doesn't have.`;
  return checkoutProblems(claimed, checkout).length === 0 ? own : `${own} This already fails the verdict, whatever you find; check every criterion anyway, so ${agentId} learns all there is to fix at once.`;
}
