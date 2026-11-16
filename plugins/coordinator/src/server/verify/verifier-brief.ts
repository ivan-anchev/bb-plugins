// A verifier thread's first message: the commit to check, the checkout as the plugin read it, and
// each done-criterion, numbered as crew_verdict takes them. Only the coordinating thread's words,
// the commit id and bb's read are in it, never the crew's report, so the verifier checks the work
// rather than the crew's account of it.
import type { Crew } from "../../model/crew.ts";
import type { Handoff } from "../../model/handoff.ts";
import { checkoutProblems, checkoutText, type Checkout } from "../../model/verdict/checkout.ts";

export function verifierBrief(crew: Pick<Crew, "id" | "title" | "brief" | "doneCriteria">, handoff: Pick<Extract<Handoff, { status: "done" }>, "headSha">, checkout: Checkout): string {
  return [
    `# Verify ${crew.id}: ${crew.title}`,
    `Crew ${crew.id} says its work is done at commit ${handoff.headSha}, in this environment. Check every done-criterion yourself, then call crew_verdict once. Follow the verifying skill.`,
    `## The commit and the tree, as the plugin read them\n\n${checkoutText(handoff.headSha, checkout)} ${checkoutNote(handoff.headSha, checkout)}`,
    `## Done-criteria\n\n${crew.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    `## The crew's brief, for context\n\n${crew.brief.trim()}`,
    "## Rules\n\nRun whatever proves or disproves each criterion, and quote what it printed. Never edit, commit, push or check out anything: you share the crew's working tree.",
  ].join("\n\n");
}

/** What the verifier does with the plugin's read: never judge it again, and check every criterion either way. */
function checkoutNote(claimed: string, checkout: Checkout): string {
  const own = "The plugin judges the commit and the tree itself, from this read: don't check them, and don't fail a criterion over them. Your shell may show files the crew's tree doesn't have.";
  return checkoutProblems(claimed, checkout).length === 0 ? own : `${own} This already fails the verdict, whatever you find; check every criterion anyway, so the crew learns all there is to fix at once.`;
}
