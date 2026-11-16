// A verifier's own tool: crew_verdict, its judgement of each done-criterion with the evidence it
// ran. Its overall outcome is never reported: the plugin derives it (model/verdict.ts). The caller's
// role comes from the plugin's database by its thread id.
import { z } from "zod";
import { MAX_CRITERIA, type Crew } from "../../model/crew.ts";
import { commitSchema } from "../../model/handoff.ts";
import { criterionResultSchema } from "../../model/verdict/verdict.ts";
import type { Store } from "../store.ts";
import { failed, type ToolsBb } from "../tools/tool-kit.ts";
import type { Verify, VerifierReport } from "./verify.ts";

export const VERDICT = "crew_verdict";

const verdictInputSchema = z.object({
  headSha: commitSchema.describe("The 40-character output of `git rev-parse HEAD`, which you ran first."),
  criteria: z
    .array(
      z.object({
        criterion: z.number().int().min(1).max(MAX_CRITERIA).describe("The criterion's number in your first message."),
        result: criterionResultSchema.describe("pass: what you ran proves it. fail: what you ran disproves it, or HEAD or the tree was wrong. unverifiable: you could not run anything that decides it."),
        evidence: z.string().trim().min(1).max(4_000).describe("The command you ran and what it printed, quoted; for a fail, the failing lines."),
      }),
    )
    .min(1)
    .max(MAX_CRITERIA)
    .describe("One entry for every done-criterion, none skipped."),
  findings: z.array(z.string().trim().min(1).max(2_000)).max(20).describe("Problems you saw that no criterion covers. [] for none."),
});
type VerdictInput = z.infer<typeof verdictInputSchema>;

type Deps = { store: Pick<Store, "roleOfThread" | "handoff" | "crew">; verify: Pick<Verify, "returned"> };

export function registerVerdictTool(bb: ToolsBb, { store, verify }: Deps): void {
  bb.agents.registerTool({
    name: VERDICT,
    description: "Your verdict on the crew's done handoff: one result per done-criterion, with the evidence you ran. Call it once, last, then stop.",
    instructions: VERDICT_INSTRUCTIONS,
    presentation: { label: { pending: "Returning the verdict", completed: "Returned the verdict" }, icon: { glyph: "Check" } },
    parameters: verdictInputSchema,
    execute: async (input, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "verifier") return failed(`${VERDICT} is refused: only a verifier thread the plugin started returns a verdict, and this thread is not one. Carry on without it.`);
      const handoff = store.handoff(role.handoffId);
      const crew = store.crew(role.coordinatorId, role.crewId);
      // why throw: a verifier is started for a done handoff of a started crew.
      if (handoff?.status !== "done" || crew?.launch.kind !== "started") throw new Error(`The handoff ${role.handoffId} this verifier checks is missing.`);
      if (handoff.verdict.state !== "running" || handoff.verdict.verifierThreadId !== threadId) return failed(NOT_RUNNING);
      const report = reportOf(input, crew.doneCriteria);
      if (typeof report === "string") return failed(`${VERDICT} is refused and nothing was saved: ${report}`);
      if (input.headSha !== handoff.headSha && report.criteria.some((check) => check.result !== "fail")) {
        return failed(`${VERDICT} is refused and nothing was saved: HEAD was ${input.headSha}, not the claimed ${handoff.headSha}, so every criterion fails. Call it again with each one failed and say so in its evidence.`);
      }
      if (!(await verify.returned(handoff.id, threadId, crew.launch.threadId, report))) return failed(NOT_RUNNING);
      const passed = report.criteria.filter((check) => check.result === "pass").length;
      return `Verdict recorded: ${passed} of ${report.criteria.length} criteria passed. Stop here; don't change anything in this environment.`;
    },
  });
}

/** The verdict with each criterion named by its text, in the crew's order; or why it can't be taken. */
function reportOf(input: VerdictInput, doneCriteria: Crew["doneCriteria"]): VerifierReport | string {
  const numbers = input.criteria.map((check) => check.criterion);
  const missing = doneCriteria.flatMap((_, i) => (numbers.includes(i + 1) ? [] : [i + 1]));
  const unknown = numbers.filter((number) => number > doneCriteria.length);
  const repeated = numbers.filter((number, i) => numbers.indexOf(number) !== i);
  if (missing.length > 0) return `judge every done-criterion; missing ${missing.join(", ")} of 1 to ${doneCriteria.length}.`;
  if (unknown.length > 0) return `there are only ${doneCriteria.length} done-criteria; ${unknown.join(", ")} is not one.`;
  if (repeated.length > 0) return `judge each done-criterion once; ${repeated.join(", ")} appears more than once.`;
  const byNumber = new Map(input.criteria.map((check) => [check.criterion, check]));
  return {
    headSha: input.headSha,
    findings: input.findings,
    criteria: doneCriteria.map((criterion, i) => {
      const check = byNumber.get(i + 1);
      // why throw: missing numbers were refused above.
      if (check === undefined) throw new Error(`Criterion ${i + 1} has no result.`);
      return { criterion, result: check.result, evidence: check.evidence };
    }),
  };
}

const NOT_RUNNING = `${VERDICT} is refused and nothing was saved: this handoff no longer waits for your verdict (a newer handoff replaced it, or it already has one). Stop here.`;

const VERDICT_INSTRUCTIONS = `Returning your verdict: call crew_verdict once, as your last action, then stop.
- headSha: what \`git rev-parse HEAD\` printed. If it isn't the commit your first message names, or \`git status --porcelain\` printed anything, every criterion fails.
- criteria: one entry per done-criterion, by its number in your first message: result pass, fail or unverifiable, and evidence quoting what you ran and what it printed (up to 4,000 characters).
- findings: problems no criterion covers, up to 20. [] for none.`;
