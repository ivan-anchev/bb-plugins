// A verifier's own tool: issue_verdict, its judgement of each done-criterion with the evidence it
// ran. Its overall outcome is never reported: the plugin derives it (model/verdict.ts), on the
// commit and tree the check judges (verify.ts returned). The caller's role comes from the plugin's
// database by its thread id.
import { z } from "zod";
import { MAX_CRITERIA, type DoneCriteria } from "../../model/issue/issue.ts";
import { criterionResultSchema, UNCHECKABLE_RULE } from "../../model/verdict/verdict.ts";
import type { Store } from "../store/store.ts";
import { failed, refusedBusy, type ToolsBb } from "../tools/tool-kit.ts";
import type { Verify, VerifierReport } from "./verify.ts";

export const VERDICT = "issue_verdict";

const verdictInputSchema = z.object({
  criteria: z
    .array(
      z.object({
        criterion: z.number().int().min(1).max(MAX_CRITERIA).describe("The criterion's number in your first message."),
        result: criterionResultSchema.describe("pass: what you ran proves it as it is written. fail: what you ran disproves it. unverifiable: you couldn't check it as it is written; say why in evidence."),
        evidence: z.string().trim().min(1).max(4_000).describe("The command you ran and what it printed, quoted; for a fail, the failing lines."),
      }),
    )
    .min(1)
    .max(MAX_CRITERIA)
    .describe("One entry for every done-criterion, none skipped."),
  findings: z.array(z.string().trim().min(1).max(2_000)).max(20).describe("Problems you saw that no criterion covers. [] for none."),
});
type VerdictInput = z.infer<typeof verdictInputSchema>;

type Deps = { store: Pick<Store, "roleOfThread" | "check">; verify: Pick<Verify, "returned"> };

export function registerVerdictTool(bb: ToolsBb, { store, verify }: Deps): void {
  bb.agents.registerTool({
    name: VERDICT,
    description: "Your verdict on what your first message asks you to check: one result per done-criterion, with the evidence you ran. Call it once, last, then stop.",
    instructions: VERDICT_INSTRUCTIONS,
    presentation: { label: { pending: "Returning the verdict", completed: "Returned the verdict" }, icon: { glyph: "Check" } },
    parameters: verdictInputSchema,
    execute: async (input, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "verifier") return failed(`${VERDICT} is refused: only a verifier thread the plugin started returns a verdict, and this thread is not one. Carry on without it.`);
      const check = store.check(role.checkId);
      // why throw: a verifier is started for a check, and checks are kept while their regional manager is.
      if (check === null) throw new Error(`The check ${role.checkId} this verifier runs is missing.`);
      if (check.verdict.state !== "running" || check.verdict.verifierThreadId !== threadId) return failed(NOT_RUNNING);
      const report = reportOf(input, check.criteria);
      if (typeof report === "string") return failed(`${VERDICT} is refused and nothing was saved: ${report}`);
      const received = await verify.returned(check.id, threadId, report);
      if (received === "not-running") return failed(NOT_RUNNING);
      if (received === "recorded") {
        const passed = report.criteria.filter((check) => check.result === "pass").length;
        return `Verdict recorded: ${passed} of ${report.criteria.length} criteria passed. Stop here; don't change anything in this environment.`;
      }
      if ("unread" in received) return failed(`${VERDICT} is refused and nothing was saved: bb's git plugin couldn't read your worktree (${received.unread}), so the plugin couldn't judge its commit, and this final check ends without a verdict. Stop here.`);
      return refusedBusy(VERDICT, received);
    },
  });
}

/** The verdict, each criterion named by its text, in the check's order; or why it can't be taken. */
function reportOf(input: VerdictInput, doneCriteria: DoneCriteria): VerifierReport | string {
  const numbers = input.criteria.map((check) => check.criterion);
  const missing = doneCriteria.flatMap((_, i) => (numbers.includes(i + 1) ? [] : [i + 1]));
  const unknown = numbers.filter((number) => number > doneCriteria.length);
  const repeated = numbers.filter((number, i) => numbers.indexOf(number) !== i);
  if (missing.length > 0) return `judge every done-criterion; missing ${missing.join(", ")} of 1 to ${doneCriteria.length}.`;
  if (unknown.length > 0) return `there are only ${doneCriteria.length} done-criteria; ${unknown.join(", ")} is not one.`;
  if (repeated.length > 0) return `judge each done-criterion once; ${repeated.join(", ")} appears more than once.`;
  const byNumber = new Map(input.criteria.map((check) => [check.criterion, check]));
  return {
    findings: input.findings,
    criteria: doneCriteria.map((criterion, i) => {
      const check = byNumber.get(i + 1);
      // why throw: missing numbers were refused above.
      if (check === undefined) throw new Error(`Criterion ${i + 1} has no result.`);
      return { criterion, result: check.result, evidence: check.evidence };
    }),
  };
}

const NOT_RUNNING = `${VERDICT} is refused and nothing was saved: this check no longer waits for your verdict (a newer handoff or final check replaced it, or it already has one). Stop here.`;

const VERDICT_INSTRUCTIONS = `Returning your verdict: call issue_verdict once, as your last action, then stop. The plugin judges the commit and the tree itself, through bb's git plugin (your first message says when it reads them); you judge only the criteria.
- criteria: one entry per done-criterion, by its number in your first message: result pass, fail or unverifiable, and evidence quoting what you ran and what it printed (up to 4,000 characters). ${UNCHECKABLE_RULE}
- findings: problems no criterion covers, up to 20. [] for none.`;
