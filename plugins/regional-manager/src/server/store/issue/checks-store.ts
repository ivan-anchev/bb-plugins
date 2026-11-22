// Handoffs and checks: what an agent handed off, and each verifier's job on it or on a build
// parent's merged work, with the verdict's state machine. Every move of a verdict is a
// compare-and-set on where it is now, so a verifier that returns late, a tick that gives up, and a
// newer handoff or final check can't overwrite one another.
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
import { firstReview, reviewSchema, type Review, type ReviewFinding } from "../../../model/verdict/review.ts";
import { firstVerdict, isSettled, verdictSchema, type Verdict } from "../../../model/verdict/verdict.ts";
import type { ModelRef } from "../../../model/execution.ts";
import { insertEvent } from "../inbox/inbox-store.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";
import { countFixRound } from "./agents-store.ts";

/** Where a verdict must still be for a change to apply: queued, or running in this verifier thread. */
export type VerdictFrom = { state: "queued" } | { state: "running"; verifierThreadId: string };

/** Where a review must still be for a change to apply, its verdict still queued: queued, or running in this reviewer thread. */
export type ReviewFrom = { state: "queued" } | { state: "running"; reviewerThreadId: string };

type Returned = Extract<Verdict, { state: "returned" }>;

/**
 * How a returned verdict ends, or that it waits: `waiting-for-ci`, it passed every criterion and
 * waits for CI on its commit; `checked`, final and its regional manager's, with bb's refusal of its
 * findings if they were refused and what CI said; `sent-back`, its findings reached the agent for
 * the fix round it claimed; `maybe-sent-back`, its regional manager's, with that round kept, as
 * nothing shows whether they did. The last two keep the CI their claim recorded.
 */
export type Settlement = Extract<Returned["settlement"], { kind: "checked" | "waiting-for-ci" }> | { kind: "sent-back" } | { kind: "maybe-sent-back" };

/** A check still waiting for its verifier to start or to return. */
type OpenCheck = Check & { verdict: Extract<Verdict, { state: VerdictFrom["state"] }> };

/** Starts a queued check running in its verifier's thread, as the verifier's ticket binds; one superseded meanwhile stays so. Call inside a transaction. */
export function startCheck(db: Db, checkId: CheckId, verifierThreadId: string): void {
  const queued = verdictOf(db, checkId);
  if (queued?.state === "queued") writeVerdict(db, checkId, { state: "running", verifierThreadId, nudged: false, declined: [], checkout: queued.checkout });
}

/** Starts a queued review running in its reviewer's thread, as the reviewer's ticket binds; one whose check was superseded meanwhile stays as it is. Call inside a transaction. */
export function startReview(db: Db, checkId: CheckId, reviewerThreadId: string): void {
  moveReview(db, checkId, { state: "queued" }, { state: "running", reviewerThreadId, declined: [] });
}

/** Replaces the review if its verdict is still queued and it is still where `from` says, and says whether it did. Call inside a transaction. */
function moveReview(db: Db, checkId: CheckId, from: ReviewFrom, next: Review): boolean {
  const row = db().prepare("SELECT review, verdict FROM checks WHERE id = ?").get(checkId);
  if (row === undefined) return false;
  const { review, verdict } = z.object({ review: json(reviewSchema), verdict: json(verdictSchema) }).parse(row);
  const at = from.state === "queued" ? review.state === "queued" : review.state === "running" && review.reviewerThreadId === from.reviewerThreadId;
  if (verdict.state !== "queued" || !at) return false;
  db().prepare("UPDATE checks SET review = ? WHERE id = ?").run(JSON.stringify(next), checkId);
  return true;
}

/** The agent's checks that passed every criterion and wait for CI on their commit, oldest first. */
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
    // why throw: only a returned verdict has a settlement.
    if (verdict?.state !== "returned") throw new Error(`The check ${checkId} waits for CI with no returned verdict.`);
    writeVerdict(db, checkId, { ...verdict, settlement: { kind: "superseded" } });
  }
}

/** Marks every check of the issue waiting for its verifier to start or to return as superseded, in one statement; says whether there was one. */
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

  /** Replaces the verdict if it is still where `from` says, and says whether it did. Call inside a transaction. */
  function moveVerdict(checkId: CheckId, from: VerdictFrom, next: Verdict): boolean {
    const current = verdictOf(db, checkId);
    if (current === null || !isAt(current, from)) return false;
    writeVerdict(db, checkId, next);
    return true;
  }

  /** Whose check it is. why throw: callers hold a check id the store gave them. */
  function ownerOf(checkId: CheckId): { coordinatorId: CoordinatorId; issueId: IssueId } {
    const row = db().prepare("SELECT coordinator_id AS coordinatorId, issue_id AS issueId FROM checks WHERE id = ?").get(checkId);
    return z.object({ coordinatorId: coordinatorIdSchema, issueId: issueIdSchema }).parse(row);
  }

  /** The agent whose handoff the check judges. why throw: only a handoff's verdict has a fix round, and callers reach this only for one. */
  function handingAgentOf(checkId: CheckId): AgentId {
    const row = db().prepare("SELECT json_extract(subject, '$.agentId') AS agentId FROM checks WHERE id = ?").get(checkId);
    return z.object({ agentId: agentIdSchema }).parse(row).agentId;
  }

  /** The check's verdict if a verifier returned it and it is not settled yet, else null. */
  function unsettled(checkId: CheckId): Returned | null {
    const verdict = verdictOf(db, checkId);
    return verdict?.state === "returned" && !isSettled(verdict) ? verdict : null;
  }

  /** Inserts a check made of the handoff `handoffId` (null: a final check, made of none). Call inside a transaction. */
  function insertCheck({ id, coordinatorId, issueId, subject, criteria, verifier, review, verdict, at }: Check, handoffId: HandoffId | null): void {
    db()
      .prepare("INSERT INTO checks (id, coordinator_id, issue_id, handoff_id, subject, criteria, verifier, review, verdict, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, coordinatorId, issueId, handoffId, JSON.stringify(subject), JSON.stringify(criteria), jsonOrNull(verifier), JSON.stringify(review), JSON.stringify(verdict), at);
  }

  function check(checkId: CheckId): Check | null {
    const row = db().prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE id = ?`).get(checkId);
    return row === undefined ? null : toCheck(row);
  }

  /** The handoffs the clause picks, each with its check. */
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
    /** Whether the regional manager's done handoffs get a verifier from now on. why throw: callers check the id first. */
    verifies,

    /** Turns verification of the regional manager's done handoffs on or off, and records the change for it, together. Setting what is already set records nothing; returns whether it changed. */
    setVerify(coordinatorId: CoordinatorId, verify: boolean, at: number): boolean {
      return db().transaction(() => {
        const changed = db().prepare("UPDATE coordinators SET verify = ? WHERE id = ? AND verify != ?").run(Number(verify), coordinatorId, Number(verify)).changes > 0;
        if (changed) insertEvent(db, coordinatorId, { kind: "verification-toggled", verify }, at);
        return changed;
      })();
    },

    /**
     * An agent's handoff and, when it is done on an issue of a verified kind, its check, together.
     * The check copies its issue's criteria and verifier as they are now, and starts with the verdict
     * firstVerdict gives it on `checkout`, the agent's environment as read as it handed off: queued
     * for a verifier and announced with its verdict later, or else announced at once. A done handoff
     * supersedes every earlier check of its issue still waiting. A blocked or gave-up one, and a done
     * one nothing verifies, is announced at once.
     * Returns its check (null: not done).
     */
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
        // why throw: a verified kind delivers a commit (kind.ts Pipeline), and reportOf made this delivery by its kind.
        if (stored.delivery.kind !== "commit") throw new Error(`A done handoff of ${issueId}, a ${kind} issue, delivers no commit to check.`);
        const { headSha, prUrl } = stored.delivery;
        const verdict = firstVerdict(verifies(coordinatorId), checkout);
        const made: Check = {
          id: checkIdSchema.parse(randomUUID()),
          coordinatorId,
          issueId,
          at,
          criteria,
          verifier,
          subject: { kind: "handoff", agentId, handoffId: id, headSha, prUrl },
          review: firstReview(verdict),
          verdict,
        };
        insertCheck(made, id);
        if (made.verdict.state !== "queued") insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId: made.id }, at);
        return made;
      })();
    },

    /**
     * A build parent's final check, together: it supersedes the parent's final check still waiting,
     * copies the parent's criteria and verifier as they are now, and starts with the verdict
     * firstVerdict gives it: queued for a verifier, or waived and announced at once while
     * verification is off. `merged`: the Done build sub-issues whose merged work it judges. Call in
     * the parent's turn, on views current as it is written (final-check.ts).
     */
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
          review: { state: "none" },
          verdict: firstVerdict(verifies(coordinatorId), null),
        };
        insertCheck(made, null);
        if (made.verdict.state !== "queued") insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId: made.id }, at);
        return made;
      })();
    },

    /** Every final check of the issue, oldest first: none but a build parent's. */
    finalChecks(coordinatorId: CoordinatorId, issueId: IssueId): FinalCheck[] {
      return db()
        .prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE coordinator_id = ? AND issue_id = ? AND json_extract(subject, '$.kind') = 'final' ORDER BY rowid`)
        .all(coordinatorId, issueId)
        .map(toFinalCheck);
    },

    /** One handoff with its check, or null when there is none by that id. */
    handoff: (id: HandoffId): Handed | null => handed("WHERE h.id = ?", id)[0] ?? null,

    /** The agent's latest handoff with its check, or null when it has made none. */
    latestHandoff: (coordinatorId: CoordinatorId, agentId: AgentId): Handed | null =>
      handed("WHERE h.coordinator_id = ? AND h.agent_id = ? ORDER BY h.rowid DESC LIMIT 1", coordinatorId, agentId)[0] ?? null,

    /** Every handoff of every agent of the issue, each with its check, oldest first: its record. */
    record: (coordinatorId: CoordinatorId, issueId: IssueId): Handed[] => handed("WHERE h.coordinator_id = ? AND h.issue_id = ? ORDER BY h.rowid", coordinatorId, issueId),

    /** One check, or null when there is none by that id. */
    check,

    /** Every check waiting for its verifier to start or to return, oldest first. */
    openChecks(): OpenCheck[] {
      return db().prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE json_extract(verdict, '$.state') IN ('queued', 'running') ORDER BY rowid`).all().map(toOpenCheck);
    },

    /**
     * Drops the issue's check still waiting for its verifier to start or to return, as superseded:
     * its agent was asked for more work, so the handoff it judges is no longer the agent's last
     * word. A returned verdict is kept as it is. Says whether there was one.
     */
    supersedeOpenChecks: (coordinatorId: CoordinatorId, issueId: IssueId): boolean => supersedeOpen(db, coordinatorId, issueId),

    /**
     * Marks a running check's verifier as nudged (`nudged` true), once; or as not, as when its
     * reminder was taken back from bb's queue before bb sent it, so it can come again. Says whether
     * this call changed it.
     */
    markNudged(checkId: CheckId, verifierThreadId: string, nudged: boolean): boolean {
      return db().transaction(() => {
        const current = verdictOf(db, checkId);
        if (current?.state !== "running" || current.verifierThreadId !== verifierThreadId || current.nudged === nudged) return false;
        return moveVerdict(checkId, { state: "running", verifierThreadId }, { ...current, nudged });
      })();
    },

    /** Adds to a running check what its verifier asked a person that the plugin declined; says whether it is still that verifier's check. */
    recordDeclined(checkId: CheckId, verifierThreadId: string, asked: readonly string[]): boolean {
      return db().transaction(() => {
        const current = verdictOf(db, checkId);
        if (current?.state !== "running" || current.verifierThreadId !== verifierThreadId) return false;
        return moveVerdict(checkId, { state: "running", verifierThreadId }, { ...current, declined: [...current.declined, ...asked] });
      })();
    },

    /** Adds to a running review what its reviewer asked a person that the plugin declined; says whether it is still that reviewer's review. */
    recordReviewDeclined(checkId: CheckId, reviewerThreadId: string, asked: readonly string[]): boolean {
      return db().transaction(() => {
        const review = check(checkId)?.review;
        if (review?.state !== "running") return false;
        return moveReview(db, checkId, { state: "running", reviewerThreadId }, { ...review, declined: [...review.declined, ...asked] });
      })();
    },

    /** Stores a running reviewer's findings, on the model bb ran it on, if it is still the review's running reviewer and the check still waits for it; says whether it was. */
    receiveReview(checkId: CheckId, reviewerThreadId: string, findings: readonly ReviewFinding[], model: ModelRef): boolean {
      return db().transaction(() => moveReview(db, checkId, { state: "running", reviewerThreadId }, { state: "reported", reviewerThreadId, findings: [...findings], model }))();
    },

    /** Records that no review will be had, and why, if the review is still where `from` says and the check still waits for it; says whether it was. Its verifier starts next. */
    missReview(checkId: CheckId, from: ReviewFrom, reason: string): boolean {
      const reviewerThreadId = from.state === "running" ? from.reviewerThreadId : null;
      return db().transaction(() => moveReview(db, checkId, from, { state: "missed", reviewerThreadId, reason }))();
    },

    /** Gives up on a waiting check and records it checked for its regional manager, together, if it is still where `from` says; returns whose it was, or null when it had moved on. */
    giveUpCheck(checkId: CheckId, from: VerdictFrom, verdict: Extract<Verdict, { state: "could-not-run" }>, at: number): CoordinatorId | null {
      return db().transaction(() => {
        if (!moveVerdict(checkId, from, verdict)) return null;
        const { coordinatorId, issueId } = ownerOf(checkId);
        insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId }, at);
        return coordinatorId;
      })();
    },

    /** Stores a verifier's verdict, not yet settled, if its verifier is still the check's running one; says whether it was. Nobody is told until it is settled. */
    receiveVerdict(checkId: CheckId, verdict: Omit<Returned, "settlement">): boolean {
      return db().transaction(() => {
        const running = verdictOf(db, checkId);
        if (running?.state !== "running" || running.verifierThreadId !== verdict.verifierThreadId) return false;
        writeVerdict(db, checkId, { ...verdict, settlement: { kind: "pending" } });
        return true;
      })();
    },

    /** Claims the agent's next fix round for a pending verdict, or one that waited for CI, before its findings are sent: counts it on the agent and marks the verdict as going back, with what CI said, together. */
    claimFixRound(checkId: CheckId, ci: CiVerdict): void {
      db().transaction(() => {
        const verdict = unsettled(checkId);
        // why throw: it is claimed right after it was read pending or waiting, with no await between.
        if (verdict === null || verdict.settlement.kind === "sending-back") throw new Error(`The verdict of check ${checkId} is not pending, so it has no round to claim.`);
        const { coordinatorId } = ownerOf(checkId);
        writeVerdict(db, checkId, { ...verdict, settlement: { kind: "sending-back", round: countFixRound(db, coordinatorId, handingAgentOf(checkId), 1), ci } });
      })();
    },

    /**
     * Settles an unsettled verdict and records it for its regional manager, together. `sent-back`
     * and `maybe-sent-back` need a claimed round, and keep it and its CI; `checked` gives back a
     * round claimed for findings that never left. `waiting-for-ci` moves a pending verdict to wait,
     * and records nothing: nobody is told until it settles. Returns whose it was, or null when it
     * was already settled or waiting, or there is no claim to keep.
     */
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

    /** The agent's checks that passed every criterion and wait for CI on their commit, oldest first. */
    waitingForCi: (coordinatorId: CoordinatorId, agentId: AgentId): CheckId[] => waitingForCi(db, coordinatorId, agentId),

    /** Every returned verdict not settled yet, oldest first: one waiting for CI, or one a crash or a reload stopped settling. */
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

const CHECK_COLUMNS = "id, coordinator_id AS coordinatorId, issue_id AS issueId, at, criteria, verifier, subject, review, verdict";
const checkRowSchema = z.object({
  id: checkIdSchema,
  coordinatorId: coordinatorIdSchema,
  issueId: issueIdSchema,
  at: z.number(),
  criteria: json(doneCriteriaSchema),
  verifier: nullableJson(executionSchema),
  subject: json(checkSubjectSchema),
  review: json(reviewSchema),
  verdict: json(verdictSchema),
});
const toCheck = (row: unknown): Check => checkRowSchema.parse(row);

function toFinalCheck(row: unknown): FinalCheck {
  const check = toCheck(row);
  const { subject } = check;
  // why throw: the query picks only final checks.
  if (subject.kind !== "final") throw new Error(`The check ${check.id} is not a final check.`);
  return { ...check, subject };
}

function toOpenCheck(row: unknown): OpenCheck {
  const check = toCheck(row);
  const { verdict } = check;
  // why throw: every query here picks only queued and running checks.
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
