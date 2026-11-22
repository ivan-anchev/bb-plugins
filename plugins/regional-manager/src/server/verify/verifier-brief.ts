// A verifier thread's first message: what to check and where, the checkout as the plugin read it
// or will read it, and each done-criterion, numbered as issue_verdict takes them. Only the regional
// manager's words, commit ids and bb's read are in it, never an agent's report, so the verifier
// checks the work rather than an agent's account of it.
import type { AgentId } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { FinalCheck, HandoffCheck } from "../../model/verdict/check.ts";
import { checkoutProblems, checkoutText, type Checkout } from "../../model/verdict/checkout.ts";
import { UNCHECKABLE_RULE } from "../../model/verdict/verdict.ts";

/**
 * Every verifier works alone: nobody answers it, so whatever it asks a person is declined. why the
 * gh CLI: a connector or app (codex's GitHub one) can stop to ask a person to sign in, and bb gives
 * a plugin no way to start a thread without them.
 */
const ALONE_RULE =
  "Nobody answers you: anything you ask a person, or ask them to approve, is declined at once. For GitHub use the `gh` CLI in the shell, never a connector or app.";

/** A handoff's verifier's: the commit the agent claims, in the agent's own environment. */
export function verifierBrief(issue: Pick<Issue, "id" | "title"> & { brief: string }, check: Pick<HandoffCheck, "criteria" | "subject">, checkout: Checkout): string {
  const { agentId, headSha } = check.subject;
  return [
    `# Verify ${issue.id}: ${issue.title}`,
    `Agent ${agentId} says its work on ${issue.id} is done at commit ${headSha}, in this environment. Check every done-criterion yourself, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree, as the plugin read them\n\n${checkoutText(headSha, checkout)} ${checkoutNote(agentId, headSha, checkout)}`,
    criteriaPart(check.criteria),
    `## The issue's brief, for context\n\n${issue.brief.trim()}`,
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

const criteriaPart = (criteria: readonly string[]): string => `## Done-criteria\n\n${criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`;

/** What the verifier does with the plugin's read: never judge it again, and check every criterion either way. */
function checkoutNote(agentId: AgentId, claimed: string, checkout: Checkout): string {
  const own = `The plugin judges the commit and the tree itself, from this read: don't check them, and don't fail a criterion over them. Your shell may show files ${agentId}'s tree doesn't have.`;
  return checkoutProblems(claimed, checkout).length === 0 ? own : `${own} This already fails the verdict, whatever you find; check every criterion anyway, so ${agentId} learns all there is to fix at once.`;
}
