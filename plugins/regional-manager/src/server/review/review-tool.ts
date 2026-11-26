// A reviewer's own tool: issue_review, the findings of its review of a done handoff's diff, each at
// a file and line with a severity, its claim and its origin, and, on a later round, its answer on
// each of the earlier round's blocking findings. The verifier triages them next (verdict-tool.ts).
// The caller's role comes from the plugin's database by its thread id.
import { z } from "zod";
import { ANCHOR_RULE, MAX_REPORTED, MISSED_RULE, severitySchema } from "../../model/verdict/review.ts";
import type { Store } from "../store/store.ts";
import { failed, refusedBusy, type ToolsBb } from "../tools/tool-kit.ts";
import type { Review } from "./review.ts";

export const REVIEW = "issue_review";

const reviewInputSchema = z.object({
  findings: z
    .array(
      z.object({
        file: z.string().min(1).max(500).describe("The file the finding is in, as the diff names it."),
        line: z.number().int().min(1).nullable().describe("The line in that file at the reviewed commit; null when the finding names no one line."),
        severity: severitySchema.describe(
          `must-fix: the severity CREW.md gives a finding. Report it as must-fix even when it breaks none of the five things below, and say in the claim which it breaks, or that it breaks none: the verifier anchors or downgrades it, never you. should-fix: worth fixing before it merges. nit: a small improvement. ${ANCHOR_RULE}`,
        ),
        claim: z.string().trim().min(1).max(2_000).describe("What is wrong there, and why, in a few lines."),
        origin: z
          .enum(["new", "missed"])
          .default("new")
          .describe(`new: on code changed since the last reviewed commit, or any finding of a first round. missed: on code an earlier round reviewed unchanged, only on a later round. ${MISSED_RULE}`),
      }),
    )
    .max(MAX_REPORTED)
    .describe("Every finding of your review. [] when you found nothing."),
  earlier: z
    .array(
      z.object({
        finding: z.number().int().min(1).describe("The earlier blocking finding's number in your first message."),
        fixed: z.boolean().describe("Whether this diff fixes it."),
        note: z.string().trim().min(1).max(1_000).describe("What you saw that shows it, in a line or two."),
      }),
    )
    .default([])
    .describe("On a later round, one answer for every blocking finding of the earlier round your first message numbers, none skipped. One not fixed goes to the verifier again: don't report it again in findings. [] on a first round."),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

type Deps = { store: Pick<Store, "roleOfThread" | "check">; review: Pick<Review, "reported"> };

export function registerReviewTool(bb: ToolsBb, { store, review }: Deps): void {
  bb.agents.registerTool({
    name: REVIEW,
    description: "Your review of the diff your first message names: every finding, each with its file, line, severity and claim. Call it last; when it refuses what you passed, correct that and call it again.",
    instructions: REVIEW_INSTRUCTIONS,
    presentation: { label: { pending: "Reporting the review", completed: "Reported the review" }, icon: { glyph: "Search" } },
    parameters: reviewInputSchema,
    execute: async (input, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "reviewer") return failed(`${REVIEW} is refused: only a reviewer thread the plugin started reports a review, and this thread is not one. Carry on without it.`);
      const check = store.check(role.checkId);
      // why throw: a reviewer is started for a check, and checks are kept while their regional manager is.
      if (check === null) throw new Error(`The check ${role.checkId} this reviewer runs is missing.`);
      const running = check.verdict.state === "queued" && check.review.state === "running" && check.review.reviewerThreadId === threadId;
      if (!running) return failed(NOT_RUNNING);
      const received = await review.reported(check.id, threadId, input);
      if (received === "not-running") return failed(NOT_RUNNING);
      if (received === "recorded") return `Review recorded: ${recordedText(input)}. A verifier triages them next. Stop here; don't change anything in this environment.`;
      if ("refused" in received) return failed(`${REVIEW} is refused and nothing was saved: ${received.refused}\n\nCorrect that and call ${REVIEW} again.`);
      return refusedBusy(REVIEW, received);
    },
  });
}

/** What a recorded review holds, in words: "2 findings", "no findings, and 1 earlier blocking finding not fixed". */
function recordedText({ findings, earlier }: ReviewInput): string {
  const found = findings.length === 0 ? "no findings" : `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
  const unfixed = earlier.filter(({ fixed }) => !fixed).length;
  return unfixed === 0 ? found : `${found}, and ${unfixed} earlier blocking finding${unfixed === 1 ? "" : "s"} not fixed`;
}

const NOT_RUNNING = `${REVIEW} is refused and nothing was saved: this review no longer waits for your findings (a newer handoff replaced it, or it ended without them). Stop here.`;

const REVIEW_INSTRUCTIONS = `Reporting your review: call ${REVIEW} as your last action. When it refuses what you passed, nothing was saved: correct what it names and call it again. Stop once it records your review, or once it refuses because this review no longer waits for it. Each finding names its file, its line (null when it names no one line), its severity (must-fix, should-fix or nit), its claim and, on a later round, its origin: new, or missed when it sits on code an earlier round reviewed unchanged. [] when you found nothing. On a later round, earlier answers each blocking finding of the earlier round your first message numbers: fixed or not, with a note; [] on a first round. CREW.md says what to look for; this rule alone says what blocks. ${ANCHOR_RULE} A verifier checks each finding: it rejects one that doesn't hold, anchors a must-fix to what it breaks, downgrades one that breaks none of the five, and confirms the rest. Every one that holds goes back to the agent in its automatic fix round. A turn that ends before you call it ends your review unheard, so run what you need in the foreground and don't end your turn to wait for it.`;
