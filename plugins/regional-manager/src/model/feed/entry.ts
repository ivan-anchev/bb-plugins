// One item in an issue's feed, as the tab draws it and the issueFeed RPC carries it: the one type
// for the concept, from feedOf to the component.
import { z } from "zod";
import { agentIdSchema, endedHowSchema } from "../agent/agent.ts";
import { issueDecisionSchema } from "../decision.ts";
import { issueIdSchema } from "../issue/issue.ts";
import { issueStatusSchema } from "../issue/status.ts";
import { prBadgeSchema, prChangeSchema } from "../verdict/pr.ts";
import { filedWhenSchema } from "../verdict/rounds/follow-up.ts";
import { commentSchema } from "./comment.ts";
import { lineEventSchema } from "./log-event.ts";
import { roundSchema } from "./round.ts";

const at = z.number();
export const entrySchema = z.discriminatedUnion("kind", [
  /** The issue was filed: by the manager, or by the plugin as the follow-up of `followUpOf` when that issue passed or was accepted as it was (rounds/follow-up.ts). */
  z.object({ kind: z.literal("created"), at, followUpOf: z.object({ issueId: issueIdSchema, when: filedWhenSchema }).nullable() }),
  /** A change to the issue's plan, or where its log began. */
  z.object({ kind: z.literal("logged"), at, event: lineEventSchema }),
  z.object({ kind: z.literal("agent-started"), at, agentId: agentIdSchema }),
  z.object({ kind: z.literal("agent-ended"), at, agentId: agentIdSchema, how: endedHowSchema }),
  /** A round, at when it began (its handed step). why only a round carries statuses (its steps'): a line or a card says what it did, and the tab's header the status now. */
  z.object({ kind: z.literal("round"), round: roundSchema }),
  /** A question put to the user about the issue, at when it was asked, or a decision the manager recorded on it (its own `at`). */
  z.object({ kind: z.literal("decision"), decision: issueDecisionSchema }),
  /** A comment on the issue, at when it was posted. */
  z.object({ kind: z.literal("comment"), comment: commentSchema }),
  /** The issue's pull request changed: what changed, and the pull request as the read that saw the change found it. */
  z.object({ kind: z.literal("pr"), at, pr: prBadgeSchema, changes: z.array(prChangeSchema) }),
  /** The agent's thread said something the plugin told its manager of: it ended a turn with no handoff, failed, or waits on a person. */
  z.object({
    kind: z.literal("thread"),
    at,
    agentId: agentIdSchema,
    event: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("reported-back"), lastAnswer: z.string().nullable() }),
      z.object({ kind: z.literal("failed"), error: z.string().nullable() }),
      z.object({ kind: z.literal("needs-input"), question: z.string() }),
    ]),
  }),
  /** Its pass filed the findings its rounds held without blocking it, or its accept the findings it left, as the follow-up `issueId` (rounds/follow-up.ts), at when it was filed. */
  z.object({ kind: z.literal("follow-up"), at, issueId: issueIdSchema, when: filedWhenSchema }),
  /** The last of its dependencies still open, `by`, closed. */
  z.object({ kind: z.literal("unblocked"), at, by: issueIdSchema }),
  /** A status the plugin observed the issue move to that no moment since the one before explains, as a parent rolling up or a turn ending. */
  z.object({ kind: z.literal("moved"), at, status: issueStatusSchema }),
]);
export type Entry = z.infer<typeof entrySchema>;

/** When the moment an entry tells happened. why not a field of every entry: a round and a decision carry their own. */
export function timeOf(entry: Entry): number {
  switch (entry.kind) {
    case "round":
      return entry.round.handed.at;
    case "decision":
      return entry.decision.at;
    case "comment":
      return entry.comment.at;
    case "created":
    case "logged":
    case "moved":
    case "agent-started":
    case "agent-ended":
    case "pr":
    case "thread":
    case "follow-up":
    case "unblocked":
      return entry.at;
    default:
      return entry satisfies never;
  }
}

/** What the reader picks to see: everything, the work, or the why (comments, decisions and questions). */
export type Filter = "all" | "rounds" | "discussion";

/** Whether the filter shows the entry. */
export function shownIn(filter: Filter, entry: Entry): boolean {
  switch (filter) {
    case "all":
      return true;
    case "rounds":
      return entry.kind === "round";
    case "discussion":
      return entry.kind === "decision" || entry.kind === "comment";
    default:
      return filter satisfies never;
  }
}
