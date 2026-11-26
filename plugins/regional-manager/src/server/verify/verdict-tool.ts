// A verifier's own tool: issue_verdict, its judgement of each done-criterion with the evidence it
// ran, and its triage of each finding its first message lists. Its overall outcome is never reported: the plugin derives it (model/verdict.ts), on the
// commit and tree the check judges (verify.ts returned). The caller's role comes from the plugin's
// database by its thread id.
import { z } from "zod";
import { MAX_CRITERIA } from "../../model/issue/issue.ts";
import type { Check } from "../../model/verdict/check.ts";
import { ANCHOR_RULE, anchorProblem, blockingDefectSchema, numberedText, placeText, TRIAGE_RULE, triageProblem, triageVariants, type BlockingDefect, type ReviewFinding } from "../../model/verdict/review.ts";
import { triageList } from "../../model/verdict/rounds/delta.ts";
import { criterionResultSchema, UNCHECKABLE_RULE } from "../../model/verdict/verdict.ts";
import type { Store } from "../store/store.ts";
import { earlierDefectsOf, scopeOf } from "../review/checker-brief.ts";
import { failed, numbersRefusal, refusedBusy, type ToolsBb } from "../tools/tool-kit.ts";
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
  findings: z.array(z.string().trim().min(1).max(2_000)).max(20).describe("Problems you saw that no criterion covers and that meet no blocking anchor, each with the severity CREW.md's Reviewers section gives it. They never fail the verdict. [] for none."),
  blocking: z
    .array(blockingDefectSchema)
    .max(20)
    .default([])
    .describe(`Defects you found yourself, as with creed-qa's checks of the surrounding code, that no criterion covers and that meet a blocking anchor: each with its anchor and, for a bug, the normal-use steps that reach it. Each one fails the verdict. ${ANCHOR_RULE} [] for none.`),
  earlierDefects: z
    .array(
      z.object({
        defect: z.number().int().min(1).describe("The earlier blocking defect's number in your first message."),
        fixed: z.boolean().describe("true only when you ran its steps again on this commit and they no longer reach it. false keeps it blocking: it fails this verdict too."),
      }),
    )
    .default([])
    .describe("One answer for every blocking defect an earlier verifier found that your first message numbers, none skipped. [] when it lists none."),
  triage: z
    .array(
      triageVariants({
        finding: z.number().int().min(1).describe("The reviewer's finding's number in your first message."),
        reason: z.string().trim().min(1).max(500).describe("Why, in a line: what you ran or read that shows it holds, or doesn't. For a downgrade, why the lower severity fits; for a downgraded must-fix, that it meets no anchor, as a principle violation or a bug that needs a contrived setup, or that it is marked missed."),
      }),
    )
    .default([])
    .describe(`One entry for every finding of the reviewer's in your first message, none skipped, by its number. ${TRIAGE_RULE} ${ANCHOR_RULE} [] when it lists none.`),
});
type VerdictInput = z.infer<typeof verdictInputSchema>;

type Deps = { store: Pick<Store, "roleOfThread" | "check" | "record" | "finalChecks">; verify: Pick<Verify, "returned"> };

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
      const report = reportOf(input, check.criteria, triagedOf(store, check), earlierOf(store, check));
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

/**
 * The findings the check's verifier triages (rounds/delta.ts triageList), on its scope; none for a
 * final check, which has no review.
 */
function triagedOf(store: Pick<Store, "record" | "finalChecks">, check: Check): ReviewFinding[] {
  const { subject } = check;
  switch (subject.kind) {
    case "handoff":
      return triageList(check.review, scopeOf(store, { ...check, subject }));
    case "final":
      return [];
    default:
      return subject satisfies never;
  }
}

/** The blocking defects an earlier verifier of the issue found, for this one to answer (checker-brief.ts earlierDefectsOf); none for a final check. */
function earlierOf(store: Pick<Store, "record">, check: Check): BlockingDefect[] {
  const { subject } = check;
  switch (subject.kind) {
    case "handoff":
      return earlierDefectsOf(store, { ...check, subject });
    case "final":
      return [];
    default:
      return subject satisfies never;
  }
}

/**
 * The verdict, each criterion named by its text, the verifier's triage of each finding it triages
 * (`findings`), in the check's order, and its blocking defects: each earlier one (`earlier`) it
 * answered not fixed, then its own; or why it can't be taken.
 */
function reportOf(input: VerdictInput, criteria: Check["criteria"], findings: readonly ReviewFinding[], earlier: readonly BlockingDefect[]): VerifierReport | string {
  const refused =
    numbersRefusal(
      input.criteria.map(({ criterion }) => criterion),
      criteria.length,
      { verb: "judge", each: "done-criterion", all: "done-criteria" },
    ) ??
    listed(
      numbersRefusal(
        input.triage.map(({ finding }) => finding),
        findings.length,
        { verb: "triage", each: "finding of the reviewer's", all: "findings of the reviewer's" },
      ),
      findings,
    ) ??
    triageRefusal(input.triage, findings) ??
    numbersRefusal(
      input.earlierDefects.map(({ defect }) => defect),
      earlier.length,
      { verb: "answer", each: "earlier blocking defect", all: "earlier blocking defects" },
    ) ??
    blockingRefusal(input.blocking);
  if (refused !== null) return refused;
  const byNumber = new Map(input.criteria.map((check) => [check.criterion, check]));
  const byFinding = new Map(input.triage.map(({ finding, ...triage }) => [finding, triage]));
  return {
    findings: input.findings,
    blocking: [...earlier.filter((_, i) => input.earlierDefects.some(({ defect, fixed }) => defect === i + 1 && !fixed)), ...input.blocking],
    criteria: criteria.map((criterion, i) => {
      const check = byNumber.get(i + 1);
      // why throw: missing numbers were refused above.
      if (check === undefined) throw new Error(`Criterion ${i + 1} has no result.`);
      return { criterion, result: check.result, evidence: check.evidence };
    }),
    triage: findings.map((_, i) => {
      const triage = byFinding.get(i + 1);
      // why throw: missing numbers were refused above.
      if (triage === undefined) throw new Error(`Finding ${i + 1} has no triage.`);
      return triage;
    }),
  };
}

/**
 * A refusal of the triage's numbers, with the findings to triage listed by number, so a verifier
 * whose first message listed others, as one started before the list changed, can still triage
 * each; null when there is no refusal.
 */
function listed(refused: string | null, findings: readonly ReviewFinding[]): string | null {
  if (refused === null || findings.length === 0) return refused;
  return `${refused} The findings to triage, by number:\n\n${numberedText(findings)}`;
}

/** Why the triage of a finding can't be taken (review.ts triageProblem), naming the first such finding by its number and place; null when every entry can. */
function triageRefusal(triage: VerdictInput["triage"], findings: readonly ReviewFinding[]): string | null {
  for (const { finding: number, ...entry } of triage) {
    const finding = findings[number - 1];
    // why throw: numbersRefusal refused a number with no finding.
    if (finding === undefined) throw new Error(`Finding ${number} is not one the verifier triages.`);
    const problem = triageProblem(finding, entry);
    if (problem !== null) return `finding ${number}, the ${finding.severity} at ${placeText(finding)}: ${problem}.`;
  }
  return null;
}

/** Why a blocking defect's anchor can't be taken (review.ts anchorProblem), naming the first such defect by its number; null when every one can. */
function blockingRefusal(blocking: VerdictInput["blocking"]): string | null {
  for (const [i, defect] of blocking.entries()) {
    const problem = anchorProblem(defect, "report it in findings instead");
    if (problem !== null) return `blocking defect ${i + 1}: ${problem}.`;
  }
  return null;
}

const NOT_RUNNING = `${VERDICT} is refused and nothing was saved: this check no longer waits for your verdict (a newer handoff or final check replaced it, or it already has one). Stop here.`;

const VERDICT_INSTRUCTIONS = `Returning your verdict: call issue_verdict as your last action. When it refuses what you passed (a criterion or finding skipped, repeated or invented, or a triage the rule refuses), nothing was saved: correct what it names and call it again. Stop once it records your verdict, or refuses because the check no longer waits for it or your worktree couldn't be read. The plugin judges the commit and the tree itself; you judge the criteria and triage the reviewer's findings.
- criteria: one entry per done-criterion, by its number in your first message: result pass, fail or unverifiable, and evidence quoting what you ran and what it printed (up to 4,000 characters). ${UNCHECKABLE_RULE}
- blocking: defects you found yourself outside the criteria, as with creed-qa, that meet a blocking anchor (below), up to 20: claim, anchor, and steps for a bug, safety or regression anchor. Each fails the verdict. [] for none.
- earlierDefects: an answer for each earlier blocking defect your first message numbers: fixed only when its steps no longer reach it; one not fixed fails this verdict. [] for none.
- findings: other problems no criterion covers, up to 20, with their severity; they never fail the verdict. [] for none.
- triage: when your first message lists the reviewer's findings, one entry for each by its number: result rejected, confirmed, anchored with its anchor and steps, or downgraded with to, the lower severity. ${TRIAGE_RULE} ${ANCHOR_RULE} [] when it lists none.`;
