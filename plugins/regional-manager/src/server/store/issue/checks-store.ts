import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentIdSchema, type AgentId } from "../../../model/agent.ts";
import { executionSchema } from "../../../model/execution.ts";
import { handoffIdSchema, handoffReportSchema, type HandoffId, type Handoff } from "../../../model/handoff.ts";
import { doneCriteriaSchema, issueIdSchema, type IssueId } from "../../../model/issue/issue.ts";
import { isVerified, kindSchema } from "../../../model/issue/kind.ts";
import type { Handed } from "../../../model/issue/status.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import { checkIdSchema, checkSubjectSchema, type Check, type CheckId, type FinalCheck } from "../../../model/verdict/check.ts";
import type { CheckoutRead } from "../../../model/verdict/checkout.ts";
import type { CiVerdict } from "../../../model/verdict/pr.ts";
import { firstVerdict, isSettled, verdictSchema, type Verdict } from "../../../model/verdict/verdict.ts";
import { insertEvent } from "../inbox/inbox-store.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";
import { countFixRound } from "./agents-store.ts";

/** Where a verdict must still be for a change to apply: queued, or running in this verifier thread. */
export type VerdictFrom = { state: "queued" } | { state: "running"; verifierThreadId: string };

type Returned = Extract<Verdict, { state: "returned" }>;

/**
 * How a returned verdict ends, or that it waits: `waiting-for-ci`, it passed every criterion and
 * waits for CI on its commit; `checked`, final and its regional manager's, with bb's refusal of its
 * findings if they were refused and what CI said; `sent-back`, its findings reached the agent for
 * the fix round it claimed; `maybe-sent-back`, its regional manager's, with that round kept, as
 * nothing shows whether they did. The last two keep the CI their claim recorded.
 */
export type Settlement = Extract<Returned["settlement"], { kind: "checked" | "waiting-for-ci" }> | { kind: "sent-back" } | { kind: "maybe-sent-back" };

type OpenCheck = Check & { verdict: Extract<Verdict, { state: VerdictFrom["state"] }> };

/** Starts a queued check running in its verifier's thread, as the verifier's ticket binds; one superseded meanwhile stays so. Call inside a transaction. */
export function startCheck(db: Db, checkId: CheckId, verifierThreadId: string): void {
  const queued = verdictOf(db, checkId);
  if (queued?.state === "queued") writeVerdict(db, checkId, { state: "running", verifierThreadId, nudged: false, declined: [], checkout: queued.checkout });
}

function waitingForCi(db: Db, coordinatorId: CoordinatorId, agentId: AgentId): CheckId[] {
  return db()
    .prepare(
      `SELECT id FROM checks
        WHERE coordinator_id = ? AND json_extract(subject, '$.agentId') = ? AND json_extract(verdict, '$.settlement.kind') = 'waiting-for-ci'
        ORDER BY rowid`,
    )
    .all(coordinatorId, agentId)
    .map(toCheckId);
}

/**
 * Marks every check of the issue still waiting as superseded, whichever of its agents handed off: a
 * newer done handoff or a new agent makes them moot, and a new final check of a parent its last. One waiting for its verifier has no verdict to
 * keep; one waiting for CI keeps its returned verdict whole, settled as superseded. Its verifier may
 * still run: whatever starts next on the issue asks bb, and stops it. Call inside a transaction.
 */
export function supersedeChecks(db: Db, coordinatorId: CoordinatorId, issueId: IssueId): void {
  supersedeOpen(db, coordinatorId, issueId);
  const waiting = db()
    .prepare("SELECT id FROM checks WHERE coordinator_id = ? AND issue_id = ? AND json_extract(verdict, '$.settlement.kind') = 'waiting-for-ci'")
    .all(coordinatorId, issueId)
    .map(toCheckId);
  for (const checkId of waiting) {
    const verdict = verdictOf(db, checkId);
    if (verdict?.state !== "returned") throw new Error(`The check ${checkId} waits for CI with no returned verdict.`);
    writeVerdict(db, checkId, { ...verdict, settlement: { kind: "superseded" } });
  }
}

function supersedeOpen(db: Db, coordinatorId: CoordinatorId, issueId: IssueId): boolean {
  const superseded: Verdict = { state: "superseded" };
  return (
    db()
      .prepare("UPDATE checks SET verdict = ? WHERE coordinator_id = ? AND issue_id = ? AND json_extract(verdict, '$.state') IN ('queued', 'running')")
      .run(JSON.stringify(superseded), coordinatorId, issueId).changes > 0
  );
}

export function checksStore(db: Db) {
  function verifies(coordinatorId: CoordinatorId): boolean {
    return z.object({ verify: z.number() }).parse(db().prepare("SELECT verify FROM coordinators WHERE id = ?").get(coordinatorId)).verify === 1;
  }

  function moveVerdict(checkId: CheckId, from: VerdictFrom, next: Verdict): boolean {
    const current = verdictOf(db, checkId);
    if (current === null || !isAt(current, from)) return false;
    writeVerdict(db, checkId, next);
    return true;
  }

  function ownerOf(checkId: CheckId): { coordinatorId: CoordinatorId; issueId: IssueId } {
    const row = db().prepare("SELECT coordinator_id AS coordinatorId, issue_id AS issueId FROM checks WHERE id = ?").get(checkId);
    return z.object({ coordinatorId: coordinatorIdSchema, issueId: issueIdSchema }).parse(row);
  }

  function handingAgentOf(checkId: CheckId): AgentId {
    const row = db().prepare("SELECT json_extract(subject, '$.agentId') AS agentId FROM checks WHERE id = ?").get(checkId);
    return z.object({ agentId: agentIdSchema }).parse(row).agentId;
  }

  function unsettled(checkId: CheckId): Returned | null {
    const verdict = verdictOf(db, checkId);
    return verdict?.state === "returned" && !isSettled(verdict) ? verdict : null;
  }

  function insertCheck({ id, coordinatorId, issueId, subject, criteria, verifier, verdict, at }: Check, handoffId: HandoffId | null): void {
    db()
      .prepare("INSERT INTO checks (id, coordinator_id, issue_id, handoff_id, subject, criteria, verifier, verdict, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, coordinatorId, issueId, handoffId, JSON.stringify(subject), JSON.stringify(criteria), jsonOrNull(verifier), JSON.stringify(verdict), at);
  }

  function check(checkId: CheckId): Check | null {
    const row = db().prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE id = ?`).get(checkId);
    return row === undefined ? null : toCheck(row);
  }

  function handed(clause: string, ...params: string[]): Handed[] {
    return db()
      .prepare(`SELECT ${HANDOFF_COLUMNS}, c.id AS checkId FROM handoffs h LEFT JOIN checks c ON c.handoff_id = h.id ${clause}`)
      .all(...params)
      .map((row) => {
        const { checkId } = z.object({ checkId: checkIdSchema.nullable() }).parse(row);
        return { handoff: toHandoff(row), check: checkId === null ? null : check(checkId) };
      });
  }

  return {
    verifies,

    setVerify(coordinatorId: CoordinatorId, verify: boolean, at: number): boolean {
      return db().transaction(() => {
        const changed = db().prepare("UPDATE coordinators SET verify = ? WHERE id = ? AND verify != ?").run(Number(verify), coordinatorId, Number(verify)).changes > 0;
        if (changed) insertEvent(db, coordinatorId, { kind: "verification-toggled", verify }, at);
        return changed;
      })();
    },

    insertHandoff(handoff: Handoff, checkout: CheckoutRead): Check | null {
      const { id, coordinatorId, issueId, agentId, at, turnSeq, ...report } = handoff;
      return db().transaction(() => {
        const stored = handoffReportSchema.parse(report);
        db().prepare("INSERT INTO handoffs (id, coordinator_id, issue_id, agent_id, report, turn_seq, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, coordinatorId, issueId, agentId, JSON.stringify(stored), turnSeq, at);
        if (stored.status !== "done") {
          insertEvent(db, coordinatorId, { kind: "handoff", issueId, agentId, handoffId: id, status: stored.status }, at);
          return null;
        }
        supersedeChecks(db, coordinatorId, issueId);
        const { kind, criteria, verifier } = z
          .object({ kind: kindSchema, criteria: json(doneCriteriaSchema), verifier: nullableJson(executionSchema) })
          .parse(db().prepare("SELECT kind, done_criteria AS criteria, verifier FROM issues WHERE coordinator_id = ? AND id = ?").get(coordinatorId, issueId));
        if (!isVerified(kind)) {
          insertEvent(db, coordinatorId, { kind: "handoff", issueId, agentId, handoffId: id, status: stored.status }, at);
          return null;
        }
        if (stored.delivery.kind !== "commit") throw new Error(`A done handoff of ${issueId}, a ${kind} issue, delivers no commit to check.`);
        const { headSha, prUrl } = stored.delivery;
        const made: Check = {
          id: checkIdSchema.parse(randomUUID()),
          coordinatorId,
          issueId,
          at,
          criteria,
          verifier,
          subject: { kind: "handoff", agentId, handoffId: id, headSha, prUrl },
          verdict: firstVerdict(verifies(coordinatorId), checkout),
        };
        insertCheck(made, id);
        if (made.verdict.state !== "queued") insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId: made.id }, at);
        return made;
      })();
    },

    insertFinalCheck(coordinatorId: CoordinatorId, issueId: IssueId, subject: Omit<FinalCheck["subject"], "kind">, at: number): FinalCheck {
      return db().transaction(() => {
        supersedeChecks(db, coordinatorId, issueId);
        const { criteria, verifier } = z
          .object({ criteria: json(doneCriteriaSchema), verifier: nullableJson(executionSchema) })
          .parse(db().prepare("SELECT done_criteria AS criteria, verifier FROM issues WHERE coordinator_id = ? AND id = ?").get(coordinatorId, issueId));
        const made: FinalCheck = {
          id: checkIdSchema.parse(randomUUID()),
          coordinatorId,
          issueId,
          at,
          criteria,
          verifier,
          subject: { kind: "final", ...subject },
          verdict: firstVerdict(verifies(coordinatorId), null),
        };
        insertCheck(made, null);
        if (made.verdict.state !== "queued") insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId: made.id }, at);
        return made;
      })();
    },

    finalChecks(coordinatorId: CoordinatorId, issueId: IssueId): FinalCheck[] {
      return db()
        .prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE coordinator_id = ? AND issue_id = ? AND json_extract(subject, '$.kind') = 'final' ORDER BY rowid`)
        .all(coordinatorId, issueId)
        .map(toFinalCheck);
    },

    handoff: (id: HandoffId): Handed | null => handed("WHERE h.id = ?", id)[0] ?? null,

    latestHandoff: (coordinatorId: CoordinatorId, agentId: AgentId): Handed | null =>
      handed("WHERE h.coordinator_id = ? AND h.agent_id = ? ORDER BY h.rowid DESC LIMIT 1", coordinatorId, agentId)[0] ?? null,

    record: (coordinatorId: CoordinatorId, issueId: IssueId): Handed[] => handed("WHERE h.coordinator_id = ? AND h.issue_id = ? ORDER BY h.rowid", coordinatorId, issueId),

    check,

    openChecks(): OpenCheck[] {
      return db().prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE json_extract(verdict, '$.state') IN ('queued', 'running') ORDER BY rowid`).all().map(toOpenCheck);
    },

    supersedeOpenChecks: (coordinatorId: CoordinatorId, issueId: IssueId): boolean => supersedeOpen(db, coordinatorId, issueId),

    markNudged(checkId: CheckId, verifierThreadId: string, nudged: boolean): boolean {
      return db().transaction(() => {
        const current = verdictOf(db, checkId);
        if (current?.state !== "running" || current.verifierThreadId !== verifierThreadId || current.nudged === nudged) return false;
        return moveVerdict(checkId, { state: "running", verifierThreadId }, { ...current, nudged });
      })();
    },

    recordDeclined(checkId: CheckId, verifierThreadId: string, asked: readonly string[]): boolean {
      return db().transaction(() => {
        const current = verdictOf(db, checkId);
        if (current?.state !== "running" || current.verifierThreadId !== verifierThreadId) return false;
        return moveVerdict(checkId, { state: "running", verifierThreadId }, { ...current, declined: [...current.declined, ...asked] });
      })();
    },

    giveUpCheck(checkId: CheckId, from: VerdictFrom, verdict: Extract<Verdict, { state: "could-not-run" }>, at: number): CoordinatorId | null {
      return db().transaction(() => {
        if (!moveVerdict(checkId, from, verdict)) return null;
        const { coordinatorId, issueId } = ownerOf(checkId);
        insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId }, at);
        return coordinatorId;
      })();
    },

    receiveVerdict(checkId: CheckId, verdict: Omit<Returned, "settlement">): boolean {
      return db().transaction(() => {
        const running = verdictOf(db, checkId);
        if (running?.state !== "running" || running.verifierThreadId !== verdict.verifierThreadId) return false;
        writeVerdict(db, checkId, { ...verdict, settlement: { kind: "pending" } });
        return true;
      })();
    },

    claimFixRound(checkId: CheckId, ci: CiVerdict): void {
      db().transaction(() => {
        const verdict = unsettled(checkId);
        if (verdict === null || verdict.settlement.kind === "sending-back") throw new Error(`The verdict of check ${checkId} is not pending, so it has no round to claim.`);
        const { coordinatorId } = ownerOf(checkId);
        writeVerdict(db, checkId, { ...verdict, settlement: { kind: "sending-back", round: countFixRound(db, coordinatorId, handingAgentOf(checkId), 1), ci } });
      })();
    },

    settleReturned(checkId: CheckId, as: Settlement, at: number): CoordinatorId | null {
      return db().transaction(() => {
        const verdict = unsettled(checkId);
        if (verdict === null) return null;
        const { settlement } = verdict;
        const { coordinatorId, issueId } = ownerOf(checkId);
        if (as.kind === "waiting-for-ci") {
          if (settlement.kind !== "pending") return null;
          writeVerdict(db, checkId, { ...verdict, settlement: as });
          return coordinatorId;
        }
        if (as.kind === "checked") {
          if (settlement.kind === "sending-back") countFixRound(db, coordinatorId, handingAgentOf(checkId), -1);
          writeVerdict(db, checkId, { ...verdict, settlement: as });
          insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId }, at);
          return coordinatorId;
        }
        if (settlement.kind !== "sending-back") return null;
        const { round, ci } = settlement;
        writeVerdict(db, checkId, { ...verdict, settlement: { kind: as.kind, round, ci } });
        insertEvent(db, coordinatorId, as.kind === "sent-back" ? { kind: "sent-back", issueId, agentId: handingAgentOf(checkId), checkId, round } : { kind: "checked", issueId, checkId }, at);
        return coordinatorId;
      })();
    },

    waitingForCi: (coordinatorId: CoordinatorId, agentId: AgentId): CheckId[] => waitingForCi(db, coordinatorId, agentId),

    unsettledChecks(): CheckId[] {
      return db().prepare("SELECT id FROM checks WHERE json_extract(verdict, '$.settlement.kind') IN ('pending', 'sending-back', 'waiting-for-ci') ORDER BY rowid").all().map(toCheckId);
    },
  };
}

function verdictOf(db: Db, checkId: CheckId): Verdict | null {
  const row = db().prepare("SELECT verdict FROM checks WHERE id = ?").get(checkId);
  return row === undefined ? null : z.object({ verdict: json(verdictSchema) }).parse(row).verdict;
}

function writeVerdict(db: Db, checkId: CheckId, verdict: Verdict): void {
  db().prepare("UPDATE checks SET verdict = ? WHERE id = ?").run(JSON.stringify(verdict), checkId);
}

const isAt = (verdict: Verdict, from: VerdictFrom): boolean =>
  from.state === "queued" ? verdict.state === "queued" : verdict.state === "running" && verdict.verifierThreadId === from.verifierThreadId;

const toCheckId = (row: unknown): CheckId => z.object({ id: checkIdSchema }).parse(row).id;

const CHECK_COLUMNS = "id, coordinator_id AS coordinatorId, issue_id AS issueId, at, criteria, verifier, subject, verdict";
const checkRowSchema = z.object({
  id: checkIdSchema,
  coordinatorId: coordinatorIdSchema,
  issueId: issueIdSchema,
  at: z.number(),
  criteria: json(doneCriteriaSchema),
  verifier: nullableJson(executionSchema),
  subject: json(checkSubjectSchema),
  verdict: json(verdictSchema),
});
const toCheck = (row: unknown): Check => checkRowSchema.parse(row);

function toFinalCheck(row: unknown): FinalCheck {
  const check = toCheck(row);
  const { subject } = check;
  if (subject.kind !== "final") throw new Error(`The check ${check.id} is not a final check.`);
  return { ...check, subject };
}

function toOpenCheck(row: unknown): OpenCheck {
  const check = toCheck(row);
  const { verdict } = check;
  if (verdict.state !== "queued" && verdict.state !== "running") throw new Error(`The check ${check.id} is ${verdict.state}, not waiting`);
  return { ...check, verdict };
}

const HANDOFF_COLUMNS = "h.id, h.coordinator_id AS coordinatorId, h.issue_id AS issueId, h.agent_id AS agentId, h.report, h.turn_seq AS turnSeq, h.at";
const handoffRowSchema = z.object({
  id: handoffIdSchema,
  coordinatorId: coordinatorIdSchema,
  issueId: issueIdSchema,
  agentId: agentIdSchema,
  report: json(handoffReportSchema),
  turnSeq: z.number().int(),
  at: z.number(),
});

function toHandoff(row: unknown): Handoff {
  const { report, ...made } = handoffRowSchema.parse(row);
  return { ...made, ...report };
}
