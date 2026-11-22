// One item in an issue's feed, as the tab draws it and the issueFeed RPC carries it: the one type
// for the concept, from feedOf to the component.
import { z } from "zod";
import { agentIdSchema, endedHowSchema, type AgentId, type EndedHow } from "../agent/agent.ts";
import { issueDecisionSchema } from "../decision.ts";
import { issueIdSchema } from "../issue/issue.ts";
import { prChangeSchema } from "../verdict/pr.ts";
import { roundSchema } from "./round.ts";

const at = z.number();

export const entrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), at }),
  z.object({ kind: z.literal("agent-started"), at, agentId: agentIdSchema }),
  z.object({ kind: z.literal("agent-ended"), at, agentId: agentIdSchema, how: endedHowSchema }),
  z.object({ kind: z.literal("round"), at, round: roundSchema }),
  /** A question put to the user about the issue, at when it was asked, or a decision the manager recorded on it. */
  z.object({ kind: z.literal("decision"), at, decision: issueDecisionSchema }),
  /** The issue's pull request changed: what changed, on which number. */
  z.object({ kind: z.literal("pr"), at, number: z.number().int(), changes: z.array(prChangeSchema) }),
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
  /** The last of its dependencies still open, `by`, closed. */
  z.object({ kind: z.literal("unblocked"), at, by: issueIdSchema }),
]);
export type Entry = z.infer<typeof entrySchema>;

/** Who an entry is by, as the feed names them: someone it names, or something no one did by hand. */
export type Actor = { kind: "manager" } | { kind: "agent"; agentId: AgentId } | { kind: "verifier" } | { kind: "github" } | { kind: "bb" } | { kind: "plugin" };

/**
 * Who did it, derived from what it is. why never stored: only the manager's tools file an issue,
 * start an agent and record a decision; an agent's end says who in how it ended.
 */
export function actorOf(entry: Entry): Actor {
  switch (entry.kind) {
    case "created":
    case "agent-started":
    case "decision":
      return { kind: "manager" };
    case "agent-ended":
      return endedBy(entry.how);
    case "round":
      return entry.round.by.kind === "agent" ? { kind: "agent", agentId: entry.round.by.agentId } : { kind: "verifier" };
    case "pr":
      return { kind: "github" };
    case "thread":
      return { kind: "agent", agentId: entry.agentId };
    case "unblocked":
      return { kind: "plugin" };
    default:
      return entry satisfies never;
  }
}

/** What the reader picks to see: everything, the work, or the why (decisions and questions). */
export type Filter = "all" | "rounds" | "discussion";

/** Whether the filter shows the entry. */
export function shownIn(filter: Filter, entry: Entry): boolean {
  switch (filter) {
    case "all":
      return true;
    case "rounds":
      return entry.kind === "round";
    case "discussion":
      return entry.kind === "decision";
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
