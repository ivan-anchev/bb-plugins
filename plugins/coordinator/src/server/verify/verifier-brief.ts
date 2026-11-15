// A verifier thread's first message: the commit to check and each done-criterion, numbered as
// crew_verdict takes them. Only the coordinating thread's words and the commit id are in it, never
// the crew's report, so the verifier checks the work rather than the crew's account of it.
import type { Crew } from "../../model/crew.ts";
import type { Handoff } from "../../model/handoff.ts";

export function verifierBrief(crew: Pick<Crew, "id" | "title" | "brief" | "doneCriteria">, handoff: Pick<Extract<Handoff, { status: "done" }>, "headSha">): string {
  return [
    `# Verify ${crew.id}: ${crew.title}`,
    `Crew ${crew.id} says its work is done at commit ${handoff.headSha}, in this environment. Check every done-criterion yourself, then call crew_verdict once. Follow the verifying skill.`,
    `## First\n\nRun \`git rev-parse HEAD\` and \`git status --porcelain\`. If HEAD is not ${handoff.headSha}, or the tree has any change, fail every criterion and say so in its evidence.`,
    `## Done-criteria\n\n${crew.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    `## The crew's brief, for context\n\n${crew.brief.trim()}`,
    "## Rules\n\nRun whatever proves or disproves each criterion, and quote what it printed. Never edit, commit, push or check out anything: you share the crew's working tree.",
  ].join("\n\n");
}
