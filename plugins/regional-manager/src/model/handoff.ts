// An agent's handoff: the one structured report it ends its work with, stored whole. It is current
// until the agent's thread starts another turn; the plugin compares turns, never clock times, because
// bb threads carry no last-activity time.
import { z } from "zod";
import type { AgentId } from "./agent.ts";
import type { IssueId } from "./issue/issue.ts";
import { PIPELINES, type Kind } from "./issue/kind.ts";
import type { CoordinatorId } from "./role.ts";

export const handoffIdSchema = z.uuid().brand<"handoffId">();
export type HandoffId = z.infer<typeof handoffIdSchema>;

/** A full commit id, as `git rev-parse HEAD` prints it. */
export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);

/** How an agent's work ended. */
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

/**
 * What agent_handoff takes: one flat object, then checked as a report of its issue's kind
 * (reportOf). why flat: a model's tool schema must be an object at its top.
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

/** A handoff is current while its thread has started no later turn. `latestTurnSeq` is null when bb lists no turn. */
export const handoffIsCurrent = (handoff: Pick<Handoff, "turnSeq">, latestTurnSeq: number | null): boolean => latestTurnSeq === null || latestTurnSeq <= handoff.turnSeq;

/**
 * What an agent's done handoff hands over, by what its issue's kind delivers (kind.ts). why a
 * union keyed by what is delivered: a kind that delivers something else is a new variant, and a
 * check's subject (check.ts) takes a commit by type.
 */
export const deliverySchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("commit"), headSha: commitSchema, prUrl: prUrlSchema.nullable() })]);
export type Delivery = z.infer<typeof deliverySchema>;

/** A handoff as an agent wrote it, stored whole. */
export const handoffReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("done"), ...reportFields, delivery: deliverySchema }),
  z.object({ status: z.enum(["blocked", "gave-up"]), ...reportFields }),
]);
export type HandoffReport = z.infer<typeof handoffReportSchema>;

/** An agent's handoff. `turnSeq` is the sequence of the `turn/started` event of the turn it was made in. */
export type Handoff = { id: HandoffId; coordinatorId: CoordinatorId; issueId: IssueId; agentId: AgentId; at: number; turnSeq: number } & HandoffReport;

/** The handoff an agent of an issue of `kind` gave, as its report, or why it isn't one: a done handoff names what its kind delivers. */
export function reportOf({ status, headSha, prUrl, ...fields }: z.infer<typeof handoffFieldsSchema>, kind: Kind): HandoffReport | { refused: string } {
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
