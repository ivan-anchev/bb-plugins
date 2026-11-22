// A reviewer's own tool: issue_review, the findings of its review of a done handoff's diff, each at
// a file and line with a severity and its claim. The verifier triages them next (verdict-tool.ts).
// The caller's role comes from the plugin's database by its thread id.
import { z } from "zod";
import { severitySchema } from "../../model/verdict/review.ts";
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
        severity: severitySchema.describe("must-fix: wrong, and must not merge as it is. should-fix: worth fixing before it merges. nit: a small improvement."),
        claim: z.string().trim().min(1).max(2_000).describe("What is wrong there, and why, in a few lines."),
      }),
    )
    .max(50)
    .describe("Every finding of your review. [] when you found nothing."),
});

type Deps = { store: Pick<Store, "roleOfThread" | "check">; review: Pick<Review, "reported"> };

export function registerReviewTool(bb: ToolsBb, { store, review }: Deps): void {
  bb.agents.registerTool({
    name: REVIEW,
    description: "Your review of the diff your first message names: every finding, each with its file, line, severity and claim. Call it once, last, then stop.",
    instructions: REVIEW_INSTRUCTIONS,
    presentation: { label: { pending: "Reporting the review", completed: "Reported the review" }, icon: { glyph: "Search" } },
    parameters: reviewInputSchema,
    execute: async ({ findings }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "reviewer") return failed(`${REVIEW} is refused: only a reviewer thread the plugin started reports a review, and this thread is not one. Carry on without it.`);
      const check = store.check(role.checkId);
      // why throw: a reviewer is started for a check, and checks are kept while their regional manager is.
      if (check === null) throw new Error(`The check ${role.checkId} this reviewer runs is missing.`);
      const running = check.verdict.state === "queued" && check.review.state === "running" && check.review.reviewerThreadId === threadId;
      if (!running) return failed(NOT_RUNNING);
      const received = await review.reported(check.id, threadId, findings);
      if (received === "not-running") return failed(NOT_RUNNING);
      if (received === "recorded") return `Review recorded: ${findings.length === 0 ? "no findings" : `${findings.length} finding${findings.length === 1 ? "" : "s"}`}. A verifier triages them next. Stop here; don't change anything in this environment.`;
      return refusedBusy(REVIEW, received);
    },
  });
}

const NOT_RUNNING = `${REVIEW} is refused and nothing was saved: this review no longer waits for your findings (a newer handoff replaced it, or it ended without them). Stop here.`;

const REVIEW_INSTRUCTIONS = `Reporting your review: call ${REVIEW} once, as your last action, then stop. Each finding names its file, its line (null when it names no one line), its severity (must-fix, should-fix or nit) and its claim. [] when you found nothing. A verifier checks each finding, confirms or rejects it, and only confirmed ones reach the agent. A turn that ends before you call it ends your review unheard, so run what you need in the foreground and don't end your turn to wait for it.`;
