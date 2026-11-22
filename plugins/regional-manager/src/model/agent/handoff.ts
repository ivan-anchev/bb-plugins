// An agent's handoff: the one structured report it ends its work with, stored whole. It is current
// until the agent's thread starts another turn; the plugin compares turns, never clock times, because
// bb threads carry no last-activity time.
import { z } from "zod";
import type { AgentId } from "./agent.ts";
import type { IssueId } from "../issue/issue.ts";
import { PIPELINES, type Kind } from "../issue/kind.ts";
import { memoryFileSchema } from "../memory-file.ts";
import type { CoordinatorId } from "../role.ts";

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

/** A research issue's result: the agent's report, in markdown, whole. */
const reportSchema = z.string().trim().min(1).max(20_000);

/**
 * What agent_handoff takes: one flat object, then checked as a report of its issue's kind
 * (reportOf). why flat: a model's tool schema must be an object at its top.
 */
export const handoffFieldsSchema = z.object({
  status: handoffStatusSchema.describe(
    "done: on a build issue, every done-criterion is met and committed; on a research issue, your report is written. blocked: you need a decision or hit a problem you didn't cause. gave-up: a retried approach failed again.",
  ),
  summary: reportFields.summary.describe("One line, up to 120 characters, your regional manager can pass on as it is. Don't open it with the status: it is shown after it, as in \"Blocked: <summary>\"."),
  did: itemsSchema.describe("What you did, one item each."),
  evidence: itemsSchema.describe("On a build issue, for each done-criterion: the command you ran and what it printed. [] for none."),
  concerns: itemsSchema.describe("Anything you are unsure of. [] for none."),
  deviations: itemsSchema.describe("Where you departed from the brief, and why. [] for none."),
  findings: itemsSchema.describe("Things you noticed outside your brief. [] for none."),
  headSha: commitSchema.optional().describe("done on a build issue only, and required then: the 40-character output of `git rev-parse HEAD` after your last commit."),
  prUrl: prUrlSchema.optional().describe("done on a build issue only: the pull request you opened, if any."),
  report: reportSchema.optional().describe("done on a research issue only, and required then: your report, in markdown, up to 20,000 characters. It is your result: your regional manager reads it whole."),
});

/** A handoff is current while its thread has started no later turn. `latestTurnSeq` is null when bb lists no turn. */
export const handoffIsCurrent = (handoff: Pick<Handoff, "turnSeq">, latestTurnSeq: number | null): boolean => latestTurnSeq === null || latestTurnSeq <= handoff.turnSeq;

/**
 * What an agent's done handoff hands over, by what its issue's kind delivers (kind.ts). why a
 * union keyed by what is delivered: a kind that delivers something else is a new variant, and a
 * check's subject (check.ts) takes a commit by type.
 */
const commitDeliverySchema = z.object({ kind: z.literal("commit"), headSha: commitSchema, prUrl: prUrlSchema.nullable() });
const givenReportSchema = z.object({ kind: z.literal("report"), report: reportSchema });
/** `file`: where the plugin saved the report in its regional manager's memory as it stored the handoff (report-file.ts). */
const reportDeliverySchema = givenReportSchema.extend({ file: memoryFileSchema });
const deliverySchema = z.discriminatedUnion("kind", [commitDeliverySchema, reportDeliverySchema]);

/**
 * What the board shows of a handoff: when it was made, how the work ended, the agent's account of it,
 * and the report it delivered with its file (null: none, as a build or a blocked handoff delivers none).
 * why not a commit: the issue's row shows its pull request, and its verdict the commit checked.
 */
export const shownHandoffSchema = z.object({ id: handoffIdSchema, at: z.number(), status: handoffStatusSchema, ...reportFields, report: reportDeliverySchema.omit({ kind: true }).nullable() });
export type ShownHandoff = z.infer<typeof shownHandoffSchema>;

/** A handoff as the board shows it, with the report it delivered. */
export const shownHandoff = (handoff: Handoff): ShownHandoff => {
  const { id, at, status, summary, did, evidence, concerns, deviations, findings } = handoff;
  return { id, at, status, summary, did, evidence, concerns, deviations, findings, report: reportIn(handoff) };
};

/** The report a done handoff delivered, and the file it was saved to; null for any other handoff. */
function reportIn(handoff: HandoffReport): ShownHandoff["report"] {
  if (handoff.status !== "done") return null;
  const { delivery } = handoff;
  switch (delivery.kind) {
    case "commit":
      return null;
    case "report":
      return { report: delivery.report, file: delivery.file };
    default:
      return delivery satisfies never;
  }
}

/** A handoff as an agent wrote it, stored whole. */
export const handoffReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("done"), ...reportFields, delivery: deliverySchema }),
  z.object({ status: z.enum(["blocked", "gave-up"]), ...reportFields }),
]);
export type HandoffReport = z.infer<typeof handoffReportSchema>;

/**
 * A handoff as its agent gave it, before it is stored: a report has no file yet, since the plugin
 * picks where it goes as it stores the handoff (report-file.ts).
 */
export type GivenReport =
  | Exclude<HandoffReport, { status: "done" }>
  | (Omit<Extract<HandoffReport, { status: "done" }>, "delivery"> & { delivery: z.infer<typeof commitDeliverySchema> | z.infer<typeof givenReportSchema> });

/** Who made a handoff, when, and in which turn: `turnSeq` is the sequence of the `turn/started` event of the turn it was made in. */
type Made = { id: HandoffId; coordinatorId: CoordinatorId; issueId: IssueId; agentId: AgentId; at: number; turnSeq: number };

/** An agent's handoff, as stored. */
export type Handoff = Made & HandoffReport;

/** An agent's handoff, as given and not stored yet. */
export type GivenHandoff = Made & GivenReport;

/**
 * The handoff an agent of an issue of `kind` gave, as its report, or why it isn't one: a done
 * handoff names what its kind delivers, and whatever else it names is dropped, not refused (a
 * research agent's commit is not its result).
 */
export function reportOf({ status, headSha, prUrl, report, ...fields }: z.infer<typeof handoffFieldsSchema>, kind: Kind): GivenReport | { refused: string } {
  if (status !== "done") return { status, ...fields };
  const { delivers, label } = PIPELINES[kind];
  switch (delivers) {
    case "commit":
      if (headSha === undefined) return { refused: "A done handoff needs headSha: the output of `git rev-parse HEAD` after your last commit." };
      return { status, ...fields, delivery: { kind: "commit", headSha, prUrl: prUrl ?? null } };
    case "report":
      if (report === undefined) return { refused: `A done handoff of a ${label.toLowerCase()} issue needs report: your report, in markdown. It names no commit.` };
      return { status, ...fields, delivery: { kind: "report", report } };
    default:
      return delivers satisfies never;
  }
}
