// Roles and agents: which thread is what to the plugin, and the agents that hold issues. An agent
// is inserted holding its issue, and ended with what it left, in one transaction each.
import { z } from "zod";
import { agentIdSchema, baseSchema, endedHowSchema, placementSchema, type Agent, type AgentCheckout, type AgentId, type Base, type EndedHow, type Placement } from "../../../model/agent.ts";
import { executionSchema, type Execution } from "../../../model/execution.ts";
import { handoffIdSchema, type HandoffId } from "../../../model/handoff.ts";
import { issueIdSchema, type IssueId } from "../../../model/issue/issue.ts";
import { coordinatorIdSchema, roleSchema, type CoordinatorId, type Role } from "../../../model/role.ts";
import { insertEvent } from "../inbox/inbox-store.ts";
import { json, type Db } from "../rows.ts";
import { restIssue } from "./issues-store.ts";

/** A thread's role, under the ticket its thread is spawned with, unbound until bb names the thread. */
export function insertTicket(db: Db, ticket: string, role: Role, at: number): void {
  db().prepare("INSERT INTO roles (ticket, role, created_at) VALUES (?, ?, ?)").run(ticket, JSON.stringify(role), at);
}

/** Gives the ticket's role to the thread and returns it; null when the ticket was already bound, to this thread or another. */
export function bindRole(db: Db, ticket: string, threadId: string): Role | null {
  const row = db().prepare("UPDATE roles SET thread_id = ? WHERE ticket = ? AND thread_id IS NULL RETURNING role").get(threadId, ticket);
  return row === undefined ? null : toRole(row);
}

/** Counts one more fix round on the agent (`by` 1), or gives one back (-1), and returns the count. Call inside a transaction. */
export function countFixRound(db: Db, coordinatorId: CoordinatorId, agentId: AgentId, by: 1 | -1): number {
  const row = db().prepare("UPDATE agents SET fix_rounds = fix_rounds + ? WHERE coordinator_id = ? AND id = ? RETURNING fix_rounds AS rounds").get(by, coordinatorId, agentId);
  return z.object({ rounds: z.number().int() }).parse(row).rounds;
}

export function agentsStore(db: Db) {
  function roleOfThread(threadId: string): Role | null {
    const row = db().prepare("SELECT role FROM roles WHERE thread_id = ?").get(threadId);
    return row === undefined ? null : toRole(row);
  }

  function agents(coordinatorId: CoordinatorId, id: AgentId | null): Agent[] {
    return db()
      .prepare(
        `SELECT a.coordinator_id AS coordinatorId, a.id, a.issue_id AS issueId, a.placement, a.base, a.execution, r.thread_id AS threadId,
                a.environment_id AS environmentId, a.branch, a.head, a.fix_rounds AS fixRounds, a.started_at AS startedAt,
                a.ended_how AS endedHow, a.ended_at AS endedAt, a.left_handoff_id AS leftHandoffId
           FROM agents a JOIN roles r ON r.ticket = a.ticket
          WHERE a.coordinator_id = ? AND (? IS NULL OR a.id = ?)
          ORDER BY a.rowid`,
      )
      .all(coordinatorId, id, id)
      .map(toAgent);
  }

  return {
    /** What tools see: a thread has a role only once its ticket is bound to it. */
    roleOfThread,

    /**
     * What a session gets: the thread's bound role, else the role of the unbound ticket it carries.
     * why the ticket: a first session can start before bb's spawn answer binds it. A ticket already
     * bound belongs to its own thread, so a copy in another thread's metadata grants nothing.
     */
    roleFor(threadId: string, ticket: string | null): Role | null {
      const bound = roleOfThread(threadId);
      if (bound !== null || ticket === null) return bound;
      const row = db().prepare("SELECT role FROM roles WHERE ticket = ? AND thread_id IS NULL").get(ticket);
      return row === undefined ? null : toRole(row);
    },

    /** A verifier's unbound ticket, minted before its thread is spawned. */
    insertVerifierTicket(ticket: string, role: Extract<Role, { kind: "verifier" }>, at: number): void {
      insertTicket(db, ticket, role, at);
    },

    /**
     * The agent, holding its issue, and its unbound ticket, together, numbered after the regional
     * manager's highest; the issue rests in Todo from then on, so losing the agent leaves it there.
     * Null when an agent already holds the issue: two starts at once give one agent.
     */
    insertAgent(a: { coordinatorId: CoordinatorId; issueId: IssueId; ticket: string; placement: Placement; base: Base; execution: Execution; at: number }): AgentId | null {
      return db().transaction(() => {
        if (db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(a.coordinatorId, a.issueId) !== undefined) return null;
        // why the highest, not a count: an id is never reused.
        const { last } = z.object({ last: z.number().nullable() }).parse(db().prepare("SELECT max(CAST(substr(id, 2) AS INTEGER)) AS last FROM agents WHERE coordinator_id = ?").get(a.coordinatorId));
        const id = agentIdSchema.parse(`a${(last ?? 0) + 1}`);
        insertTicket(db, a.ticket, { kind: "agent", coordinatorId: a.coordinatorId, agentId: id }, a.at);
        db()
          .prepare("INSERT INTO agents (coordinator_id, id, issue_id, ticket, placement, base, execution, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(a.coordinatorId, id, a.issueId, a.ticket, JSON.stringify(a.placement), JSON.stringify(a.base), JSON.stringify(a.execution), a.at);
        restIssue(db, a.coordinatorId, a.issueId, "todo");
        return id;
      })();
    },

    /** Every agent of the regional manager, holding or ended, in the order started. */
    agents: (coordinatorId: CoordinatorId): Agent[] => agents(coordinatorId, null),

    /** One agent of the regional manager, or null when it has none by that id. */
    agent: (coordinatorId: CoordinatorId, id: AgentId): Agent | null => agents(coordinatorId, id)[0] ?? null,

    /** The ticket an agent's thread is spawned with. why throw: every agent is inserted with one. */
    agentTicket(coordinatorId: CoordinatorId, id: AgentId): string {
      return z.object({ ticket: z.string() }).parse(db().prepare("SELECT ticket FROM agents WHERE coordinator_id = ? AND id = ?").get(coordinatorId, id)).ticket;
    },

    /**
     * Ends the agent, once, with the handoff it leaves (its current one, or null). `placed`: whether
     * the issue keeps its place (status.ts keepsPlaceAfterEnd); when it doesn't, the issue rests
     * in Todo again and the regional manager is told, in this transaction, unless bb never started
     * its thread. Returns whether this call ended it.
     */
    endAgent(agent: Pick<Agent, "coordinatorId" | "id" | "issueId">, how: EndedHow, left: HandoffId | null, placed: boolean, at: number): boolean {
      return db().transaction(() => {
        const ended = db()
          .prepare("UPDATE agents SET ended_how = ?, ended_at = ?, left_handoff_id = ? WHERE coordinator_id = ? AND id = ? AND ended_at IS NULL")
          .run(how, at, left, agent.coordinatorId, agent.id).changes > 0;
        if (ended && !placed && how !== "spawn-failed") insertEvent(db, agent.coordinatorId, { kind: "returned-to-todo", issueId: agent.issueId, agentId: agent.id, how }, at);
        return ended;
      })();
    },

    /** Records where the agent's work is, as bb's git plugin read it while it handed off. */
    recordCheckout(coordinatorId: CoordinatorId, agentId: AgentId, { environmentId, branch, head }: AgentCheckout): void {
      db().prepare("UPDATE agents SET environment_id = ?, branch = ?, head = ? WHERE coordinator_id = ? AND id = ?").run(environmentId, branch, head, coordinatorId, agentId);
    },

    /** Records what the agent's thread ran on, as bb read it from its latest turn while it handed off. */
    recordExecution(coordinatorId: CoordinatorId, agentId: AgentId, execution: Execution): void {
      db().prepare("UPDATE agents SET execution = ? WHERE coordinator_id = ? AND id = ?").run(JSON.stringify(execution), coordinatorId, agentId);
    },
  };
}

const toRole = (row: unknown): Role => roleSchema.parse(JSON.parse(z.object({ role: z.string() }).parse(row).role));

const agentRowSchema = z.object({
  coordinatorId: coordinatorIdSchema,
  id: agentIdSchema,
  issueId: issueIdSchema,
  placement: json(placementSchema),
  base: json(baseSchema),
  execution: json(executionSchema),
  threadId: z.string().nullable(),
  environmentId: z.string().nullable(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  fixRounds: z.number().int(),
  startedAt: z.number(),
});
// why a union: how and when it ended are written together, or not at all.
const endedColumnsSchema = z.union([
  z.object({ endedHow: z.null(), endedAt: z.null() }).transform(() => null),
  z.object({ endedHow: endedHowSchema, endedAt: z.number(), leftHandoffId: handoffIdSchema.nullable() }).transform(({ endedHow, endedAt, leftHandoffId }) => ({ how: endedHow, at: endedAt, left: leftHandoffId })),
]);

function toAgent(row: unknown): Agent {
  const { environmentId, branch, head, ...agent } = agentRowSchema.parse(row);
  return { ...agent, checkout: { environmentId, branch, head }, ended: endedColumnsSchema.parse(row) };
}
