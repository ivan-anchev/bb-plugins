// One item in an issue's feed, as the tab draws it and the issueFeed RPC carries it: the one type
// for the concept, from feedOf to the component.
import { z } from "zod";
import { agentIdSchema, endedHowSchema, type EndedHow } from "../agent/agent.ts";
import { issueDecisionSchema } from "../decision.ts";
import { issueIdSchema } from "../issue/issue.ts";
import { issueStatusSchema } from "../issue/status.ts";
import { prChangeSchema } from "../verdict/pr.ts";
import { commentSchema, type CommentAuthor } from "./comment.ts";
import { lineEventSchema } from "./log-event.ts";
import { roundSchema } from "./round.ts";

const at = z.number();
/** The status the plugin observed the issue move to after this moment (feed.ts attachStatuses; null: none). A round's steps carry their own. */
const moved = issueStatusSchema.nullable();

export const entrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), at, moved }),
  /** A change to the issue's plan, or where its log began. */
  z.object({ kind: z.literal("logged"), at, event: lineEventSchema, moved }),
  z.object({ kind: z.literal("agent-started"), at, agentId: agentIdSchema, moved }),
  z.object({ kind: z.literal("agent-ended"), at, agentId: agentIdSchema, how: endedHowSchema, moved }),
  /** A round, at when it began (its handed step). */
  z.object({ kind: z.literal("round"), round: roundSchema }),
  /** A question put to the user about the issue, at when it was asked, or a decision the manager recorded on it (its own `at`). */
  z.object({ kind: z.literal("decision"), decision: issueDecisionSchema, moved }),
  /** A comment on the issue, at when it was posted. why no `moved`: a comment moves no status, so none is shown on it. */
  z.object({ kind: z.literal("comment"), comment: commentSchema }),
  /** The issue's pull request changed: what changed, on which number. */
  z.object({ kind: z.literal("pr"), at, number: z.number().int(), changes: z.array(prChangeSchema), moved }),
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
    moved,
  }),
  /** Its pass filed the findings its rounds held without blocking it as the follow-up `issueId` (rounds/follow-up.ts), at when it was filed. */
  z.object({ kind: z.literal("follow-up"), at, issueId: issueIdSchema, moved }),
  /** The last of its dependencies still open, `by`, closed. */
  z.object({ kind: z.literal("unblocked"), at, by: issueIdSchema, moved }),
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

/** Who an entry is by, as the feed names them: someone it names, or something no one did by hand. */
export type Actor = CommentAuthor | { kind: "verifier" } | { kind: "github" } | { kind: "bb" } | { kind: "plugin" };

/**
 * Who did it, derived from what it is. why never stored: only the manager's tools file an issue,
 * change its plan, start an agent and record a decision; an agent's end says who in how it ended;
 * the plugin began the log and observes every status.
 */
export function actorOf(entry: Entry): Actor {
  switch (entry.kind) {
    case "created":
    case "agent-started":
    case "decision":
      return { kind: "manager" };
    case "logged":
      return entry.event.kind === "log-began" ? { kind: "plugin" } : { kind: "manager" };
    case "moved":
      return { kind: "plugin" };
    case "agent-ended":
      return endedBy(entry.how);
    case "round":
      return entry.round.by.kind === "agent" ? { kind: "agent", agentId: entry.round.by.agentId } : { kind: "verifier" };
    case "comment":
      return entry.comment.author;
    case "pr":
      return { kind: "github" };
    case "thread":
      return { kind: "agent", agentId: entry.agentId };
    case "follow-up":
    case "unblocked":
      return { kind: "plugin" };
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

function endedBy(how: EndedHow): Actor {
  switch (how) {
    // why the manager: `stopped` is written by agent_stop alone, `replaced` by its handover.
    case "stopped":
    case "replaced":
      return { kind: "manager" };
    // why bb, not the user: bb's thread events don't say who archived or deleted it, nor why a spawn failed.
    case "archived":
    case "deleted":
    case "spawn-failed":
      return { kind: "bb" };
    default:
      return how satisfies never;
  }
}
