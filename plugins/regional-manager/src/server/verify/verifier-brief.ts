// A verifier thread's first message: the commit to check, the checkout as the plugin read it, and
// each done-criterion, numbered as issue_verdict takes them. Only the regional manager's words, the
// commit id and bb's read are in it, never the agent's report, so the verifier checks the work
// rather than the agent's account of it.
import type { AgentId } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { Check } from "../../model/verdict/check.ts";
import { checkoutProblems, checkoutText, type Checkout } from "../../model/verdict/checkout.ts";

export function verifierBrief(issue: Pick<Issue, "id" | "title"> & { brief: string }, check: Pick<Check, "criteria" | "subject">, checkout: Checkout): string {
  const { agentId, headSha } = check.subject;
  return [
    `# Verify ${issue.id}: ${issue.title}`,
    `Agent ${agentId} says its work on ${issue.id} is done at commit ${headSha}, in this environment. Check every done-criterion yourself, then call issue_verdict once. Follow the verifying skill.`,
    `## The commit and the tree, as the plugin read them\n\n${checkoutText(headSha, checkout)} ${checkoutNote(agentId, headSha, checkout)}`,
    `## Done-criteria\n\n${check.criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    `## The issue's brief, for context\n\n${issue.brief.trim()}`,
    `## Rules\n\nRun whatever proves or disproves each criterion, and quote what it printed. Never edit, commit, push or check out anything: you share ${agentId}'s working tree.`,
  ].join("\n\n");
}

/** What the verifier does with the plugin's read: never judge it again, and check every criterion either way. */
function checkoutNote(agentId: AgentId, claimed: string, checkout: Checkout): string {
  const own = `The plugin judges the commit and the tree itself, from this read: don't check them, and don't fail a criterion over them. Your shell may show files ${agentId}'s tree doesn't have.`;
  return checkoutProblems(claimed, checkout).length === 0 ? own : `${own} This already fails the verdict, whatever you find; check every criterion anyway, so ${agentId} learns all there is to fix at once.`;
}
