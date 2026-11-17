// A crew's handoff: the one structured report it ends its work with, stored whole. It is current
// until the crew's thread starts another turn; the plugin compares turns, never clock times, because
// bb threads carry no last-activity time.
import { z } from "zod";
import type { AgentId } from "./agent.ts";
import type { IssueId } from "./issue/issue.ts";
import { PIPELINES, type Kind } from "./issue/kind.ts";
import type { CoordinatorId, CrewId } from "./role.ts";
import type { Verdict } from "./verdict/verdict.ts";

export const handoffIdSchema = z.uuid().brand<"handoffId">();
export type HandoffId = z.infer<typeof handoffIdSchema>;

/** A full commit id, as `git rev-parse HEAD` prints it. */
export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);

/** How a crew's work ended. */
export const handoffStatusSchema = z.enum(["done", "blocked", "gave-up"]);

const itemsSchema = z.array(z.string().trim().min(1).max(2_000)).max(50);

const reportFields = {
  summary: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\r\n]*$/, "A summary is one line"),
  did: itemsSchema,
  evidence: itemsSchema,
  concerns: itemsSchema,
  deviations: itemsSchema,
  findings: itemsSchema,
};

const prUrlSchema = z.url({ protocol: /^https?$/ });

/** A handoff as the crew wrote it. why `done` alone needs a commit: it claims an exact artifact someone can check. */
export const handoffReportSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("done"),
    ...reportFields,
    headSha: commitSchema,
    prUrl: prUrlSchema.nullable(),
  }),
  z.object({ status: z.enum(["blocked", "gave-up"]), ...reportFields }),
]);
type HandoffReport = z.infer<typeof handoffReportSchema>;

/**
 * What crew_handoff and agent_handoff take: one flat object, then checked as a report. why flat: a
 * model's tool schema must be an object at its top, so the union is checked after it.
 */
export const handoffFieldsSchema = z.object({
  status: handoffStatusSchema.describe("done: every done-criterion is met and committed. blocked: you need a decision or hit a problem you didn't cause. gave-up: a retried approach failed again."),
  summary: reportFields.summary.describe("One line, up to 120 characters, your regional manager can pass on as it is. Don't open it with the status: it is shown after it, as in \"Blocked: <summary>\"."),
  did: itemsSchema.describe("What you did, one item each."),
  evidence: itemsSchema.describe("For each done-criterion: the command you ran and what it printed."),
  concerns: itemsSchema.describe("Anything you are unsure of. [] for none."),
  deviations: itemsSchema.describe("Where you departed from the brief, and why. [] for none."),
  findings: itemsSchema.describe("Things you noticed outside your brief. [] for none."),
  headSha: commitSchema.optional().describe("done only, and required then: the 40-character output of `git rev-parse HEAD` after your last commit."),
  prUrl: prUrlSchema.optional().describe("done only: the pull request you opened, if any."),
});

export const handoffInputSchema = handoffFieldsSchema.transform((input, ctx): HandoffReport => {
  const report = handoffReportSchema.safeParse({ ...input, prUrl: input.prUrl ?? null });
  if (report.success) return report.data;
  for (const issue of report.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  return z.NEVER;
});

type Done = Extract<HandoffReport, { status: "done" }>;
type NotDone = Exclude<HandoffReport, Done>;

type Made = { id: HandoffId; coordinatorId: CoordinatorId; crewId: CrewId; at: number; turnSeq: number };

/** A handoff as the crew made it. `turnSeq` is the sequence of the `turn/started` event of the turn it was made in. */
export type NewHandoff = Made & HandoffReport;

/** A stored handoff: a done one with its verdict, which the store writes with it. */
export type Handoff = Made & ((Done & { verdict: Verdict }) | NotDone);

/** A handoff is current while its thread has started no later turn. `latestTurnSeq` is null when bb lists no turn. */
export const handoffIsCurrent = (handoff: Pick<Handoff, "turnSeq">, latestTurnSeq: number | null): boolean => latestTurnSeq === null || latestTurnSeq <= handoff.turnSeq;

/**
 * What an agent's done handoff hands over, by what its issue's kind delivers (kind.ts). why a
 * union keyed by what is delivered: a kind that delivers something else is a new variant, and a
 * check's subject (check.ts) takes a commit by type.
 */
export const deliverySchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("commit"), headSha: commitSchema, prUrl: prUrlSchema.nullable() })]);
export type Delivery = z.infer<typeof deliverySchema>;

/** A handoff as an agent wrote it, stored whole. Replaces handoffReportSchema in commit 2. */
export const nextHandoffReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("done"), ...reportFields, delivery: deliverySchema }),
  z.object({ status: z.enum(["blocked", "gave-up"]), ...reportFields }),
]);
export type NextHandoffReport = z.infer<typeof nextHandoffReportSchema>;

/** An agent's handoff. `turnSeq` is the sequence of the `turn/started` event of the turn it was made in. Replaces Handoff in commit 2. */
export type NextHandoff = { id: HandoffId; coordinatorId: CoordinatorId; issueId: IssueId; agentId: AgentId; at: number; turnSeq: number } & NextHandoffReport;

/** The handoff an agent of an issue of `kind` gave, as its report, or why it isn't one: a done handoff names what its kind delivers. */
export function reportOf({ status, headSha, prUrl, ...fields }: z.infer<typeof handoffFieldsSchema>, kind: Kind): NextHandoffReport | { refused: string } {
  if (status !== "done") return { status, ...fields };
  const { delivers } = PIPELINES[kind];
  switch (delivers) {
    case "commit":
      if (headSha === undefined) return { refused: "A done handoff needs headSha: the output of `git rev-parse HEAD` after your last commit." };
      return { status, ...fields, delivery: { kind: "commit", headSha, prUrl: prUrl ?? null } };
    default:
      return delivers satisfies never;
  }
}
