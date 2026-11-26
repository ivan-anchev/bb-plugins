// Handoffs and checks: what an agent handed off, and each verifier's job on it or on a build
// parent's merged work, with the verdict's state machine. Every move of a verdict is a
// compare-and-set on where it is now, so a verifier that returns late, a tick that gives up, and a
// newer handoff or final check can't overwrite one another.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentIdSchema, type AgentId } from "../../../model/agent/agent.ts";
import { executionSchema } from "../../../model/agent/execution.ts";
import { handoffIdSchema, handoffReportSchema, type HandoffId, type Handoff } from "../../../model/agent/handoff.ts";
import { doneCriteriaSchema, issueIdSchema, type Issue, type IssueId } from "../../../model/issue/issue.ts";
import { isVerified, kindSchema } from "../../../model/issue/kind.ts";
import type { Closure, Handed } from "../../../model/issue/status.ts";
import type { DecisionId } from "../../../model/decision.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import { checkIdSchema, checkSubjectSchema, type Check, type CheckId, type FinalCheck, type StoredCheck } from "../../../model/verdict/check.ts";
import type { CheckoutRead } from "../../../model/verdict/checkout.ts";
import type { CiVerdict } from "../../../model/verdict/pr.ts";
import { firstReview, reviewSchema, type Review } from "../../../model/verdict/review.ts";
import { failureReasons, firstVerdict, isSettled, outcome, storedVerdictSchema, type FirstVerdict, type StoredVerdict, type Verdict } from "../../../model/verdict/verdict.ts";
import type { ModelRef } from "../../../model/agent/execution.ts";
import { capAsks, capQuestionsOf, capQuestionText, CAP_OPTIONS, countedFailures } from "../../../model/verdict/rounds/cap.ts";
import { readInOrder } from "../../../model/verdict/rounds/delta.ts";
import { followUpPlan, leftoversOf } from "../../../model/verdict/rounds/follow-up.ts";
import { numberedRounds } from "../../../model/feed/feed.ts";
import { decisionsOf, insertDecision, insertEvent } from "../inbox/inbox-store.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";
import { countFixRound } from "./agents-store.ts";
import { fileIssue, issuesOf } from "./issues-store.ts";

/** Where a verdict must still be for a change to apply: queued, or running in this verifier thread. */
export type VerdictFrom = { state: "queued" } | { state: "running"; verifierThreadId: string };

/** A reviewer's report as the store takes it: its findings and its answers on the earlier blocking findings, stored as they are. */
export type ReviewReport = Pick<Extract<Review, { state: "reported" }>, "findings" | "earlier">;

/** Where a review must still be for a change to apply, its verdict still queued: queued, or running in this reviewer thread. */
export type ReviewFrom = { state: "queued" } | { state: "running"; reviewerThreadId: string };

type Returned = Extract<Verdict, { state: "returned" }>;

/** Why no verdict will come of a check given up on: its verifier's thread, if it had one, and the reason. */
export type GivenUp = Omit<Extract<Verdict, { state: "could-not-run" }>, "state" | "at">;

/** A verifier's verdict as the store takes it: its triage only the verifier's result and reason for each finding, in the review's order, stored as it is. */
export type ReceivedVerdict = Omit<Extract<StoredVerdict, { state: "returned" }>, "settlement" | "mustFixFails" | "at">;

/** A check as it is made, with its first verdict (verdict.ts firstVerdict), which is stored as it is, and no follow-up yet. */
type NewCheck<C extends Check> = C & { verdict: FirstVerdict; followUpId: null };

/** A verdict before it returns: every state but returned, stored and read alike. */
type Unreturned = Exclude<Verdict, { state: "returned" }>;

/**
 * How a returned verdict ends, or that it waits: `waiting-for-ci`, it passed all but CI and
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
  moveReview(db, checkId, { state: "queued" }, { state: "running", reviewerThreadId, scoped: true });
}

/** Replaces the review if its verdict is still queued and it is still where `from` says, and says whether it did. Call inside a transaction. */
function moveReview(db: Db, checkId: CheckId, from: ReviewFrom, next: Review): boolean {
  const row = db().prepare("SELECT review, verdict FROM checks WHERE id = ?").get(checkId);
  if (row === undefined) return false;
  const { review, verdict } = z.object({ review: json(reviewSchema), verdict: json(storedVerdictSchema) }).parse(row);
  const at = from.state === "queued" ? review.state === "queued" : review.state === "running" && review.reviewerThreadId === from.reviewerThreadId;
  if (verdict.state !== "queued" || !at) return false;
  db().prepare("UPDATE checks SET review = ? WHERE id = ?").run(JSON.stringify(next), checkId);
  return true;
}

/** The agent's checks that passed all but CI and wait for CI on their commit, oldest first. */
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
 * keep; one waiting for CI keeps its returned verdict whole, settled as superseded. One that waits
 * for CI though it fails by the rules over it (failureReasons), as a verdict that waited before a
 * confirmed must-fix finding could fail one can (migrations.ts), is left for its next settlement to
 * judge failed. Its verifier may still run: whatever starts next on the issue asks bb, and stops
 * it. Call inside a transaction.
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
    if (failureReasons(verdict, null).length > 0) continue;
    writeSettlement(db, checkId, { kind: "superseded" });
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
  function moveVerdict(checkId: CheckId, from: VerdictFrom, next: Unreturned): boolean {
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

  /**
   * When the check just settled as one of the issue's counted failures, asks the user at its cap,
   * as the one rule says (rounds/cap.ts capAsks), leading the question with why it failed; returns
   * the question asked, for its `checked` event to record, or null. Call inside the settling
   * transaction, after its settlement is written, so the count includes it.
   */
  function askAtCap(coordinatorId: CoordinatorId, issueId: IssueId, checkId: CheckId, at: number): DecisionId | null {
    const failures = countedFailures(handed("WHERE h.coordinator_id = ? AND h.issue_id = ? ORDER BY h.rowid", coordinatorId, issueId));
    const settled = failures.find(({ id }) => id === checkId)?.verdict;
    if (settled?.state !== "returned") return null;
    const cap = capAsks(failures.length, capQuestionsOf(decisionsOf(db, coordinatorId), issueId));
    return cap === null ? null : insertDecision(db, coordinatorId, { issueId, question: capQuestionText(issueId, settled, cap), options: CAP_OPTIONS, cap }, at).id;
  }

  /**
   * When the check just settled as a pass of its issue, a done handoff's or a build parent's final
   * check, files the issue's follow-up, as the one plan says (rounds/follow-up.ts followUpPlan),
   * from every handoff round of the issue no follow-up collected yet, and stamps with it each
   * round's check it collected, and the passing check, which names the follow-up its pass filed. A
   * round is so collected once. `merged`: whether the issue's pull request had merged as the pass
   * was judged (closeOfPass). Call inside the settling transaction, after its settlement is
   * written, so the check reads as passed.
   */
  function fileFollowUp(coordinatorId: CoordinatorId, issueId: IssueId, checkId: CheckId, merged: boolean, at: number): void {
    const passed = check(checkId);
    if (passed === null || outcome(passed.verdict) !== "pass") return;
    const record = handed("WHERE h.coordinator_id = ? AND h.issue_id = ? ORDER BY h.rowid", coordinatorId, issueId);
    const collected = numberedRounds(record, finalChecksOf(coordinatorId, issueId)).flatMap((begun) => {
      const uncollected = begun.kind === "handoff" && begun.handed.check?.followUpId === null ? begun.handed.check : null;
      const leftovers = uncollected === null ? [] : leftoversOf(uncollected);
      return uncollected === null || leftovers.length === 0 ? [] : [{ round: begun.number, checkId: uncollected.id, leftovers }];
    });
    const plan = followUpPlan(issueId, firstOriginOf(coordinatorId, issueId), collected);
    if (plan === null) return;
    // why the pass's own close, never a view's: none is read here, and a pass closes its issue by itself or with a merge it was judged on, so the dependency starts knowing it and no later read announces it as news (issues-store.ts writeDependencies).
    const close = closeOfPass(passed, merged);
    const filed = fileIssue(db, coordinatorId, plan, new Map(close === null ? [] : [[issueId, close]]), at);
    // why throw, which rolls the settlement back: a top-level issue that depends only on its origin, which exists and that nothing depends on yet, breaks no plan rule (plan.ts).
    if ("refused" in filed) throw new Error(`The follow-up of ${issueId} can't be filed: ${filed.refused}`);
    const stamp = db().prepare("UPDATE checks SET follow_up_id = ? WHERE id = ?");
    for (const stamped of new Set([...collected.map((round) => round.checkId), checkId])) stamp.run(filed.issue.id, stamped);
  }

  /** The issue whose pass filed `issueId` as its follow-up; null when it is no follow-up. */
  function originOf(coordinatorId: CoordinatorId, issueId: IssueId): IssueId | null {
    const row = db().prepare("SELECT issue_id AS origin FROM checks WHERE coordinator_id = ? AND follow_up_id = ? LIMIT 1").get(coordinatorId, issueId);
    return row === undefined ? null : z.object({ origin: issueIdSchema }).parse(row).origin;
  }

  /** The issue a chain of follow-ups began at: `issueId` when it is no follow-up, else its origin's (originOf). why throw: a check is kept while its issue is. */
  function firstOriginOf(coordinatorId: CoordinatorId, issueId: IssueId): Issue {
    const origin = originOf(coordinatorId, issueId);
    if (origin !== null) return firstOriginOf(coordinatorId, origin);
    const [issue] = issuesOf(db, coordinatorId, issueId);
    if (issue === undefined) throw new Error(`The issue ${issueId} of ${coordinatorId} is missing.`);
    return issue;
  }

  /** Every final check of the issue, oldest first: none but a build parent's. */
  function finalChecksOf(coordinatorId: CoordinatorId, issueId: IssueId): FinalCheck[] {
    const ids = db()
      .prepare("SELECT id FROM checks WHERE coordinator_id = ? AND issue_id = ? AND json_extract(subject, '$.kind') = 'final' ORDER BY rowid")
      .all(coordinatorId, issueId)
      .map(toCheckId);
    if (ids.length === 0) return [];
    const read = issueChecks(db, coordinatorId, issueId);
    return ids.map((id) => toFinalCheck(read.get(id) ?? null));
  }

  /** Inserts a check made of the handoff `handoffId` (null: a final check, made of none), with its first verdict. Call inside a transaction. */
  function insertCheck({ id, coordinatorId, issueId, subject, criteria, verifier, review, verdict, at }: NewCheck<Check>, handoffId: HandoffId | null): void {
    db()
      .prepare("INSERT INTO checks (id, coordinator_id, issue_id, handoff_id, subject, criteria, verifier, review, verdict, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, coordinatorId, issueId, handoffId, JSON.stringify(subject), JSON.stringify(criteria), jsonOrNull(verifier), JSON.stringify(review), JSON.stringify(verdict), at);
  }

  const check = (checkId: CheckId): Check | null => readCheck(db, checkId);

  /** The handoffs the clause picks, each with its check, every issue's checks read once (issueChecks). */
  function handed(clause: string, ...params: string[]): Handed[] {
    const issues = new Map<string, Map<CheckId, Check>>();
    const checksOf = (coordinatorId: CoordinatorId, issueId: IssueId): Map<CheckId, Check> => {
      const key = JSON.stringify([coordinatorId, issueId]);
      const read = issues.get(key) ?? issueChecks(db, coordinatorId, issueId);
      issues.set(key, read);
      return read;
    };
    return db()
      .prepare(`SELECT ${HANDOFF_COLUMNS}, c.id AS checkId FROM handoffs h LEFT JOIN checks c ON c.handoff_id = h.id ${clause}`)
      .all(...params)
      .map((row) => {
        const { checkId } = z.object({ checkId: checkIdSchema.nullable() }).parse(row);
        const handoff = toHandoff(row);
        return { handoff, check: checkId === null ? null : (checksOf(handoff.coordinatorId, handoff.issueId).get(checkId) ?? null) };
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
        const verdict = firstVerdict(verifies(coordinatorId), checkout, at);
        const made: NewCheck<Check> = {
          id: checkIdSchema.parse(randomUUID()),
          coordinatorId,
          issueId,
          at,
          criteria,
          verifier,
          subject: { kind: "handoff", agentId, handoffId: id, headSha, prUrl },
          review: firstReview(verdict),
          verdict,
          followUpId: null,
        };
        insertCheck(made, id);
        if (made.verdict.state !== "queued") insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId: made.id, asked: null }, at);
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
        const made: NewCheck<FinalCheck> = {
          id: checkIdSchema.parse(randomUUID()),
          coordinatorId,
          issueId,
          at,
          criteria,
          verifier,
          subject: { kind: "final", ...subject },
          review: { state: "none" },
          verdict: firstVerdict(verifies(coordinatorId), null, at),
          followUpId: null,
        };
        insertCheck(made, null);
        if (made.verdict.state !== "queued") insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId: made.id, asked: null }, at);
        return made;
      })();
    },

    /** Every final check of the issue, oldest first: none but a build parent's. */
    finalChecks: finalChecksOf,

    /** The issue whose pass filed this one as its follow-up; null when it is no follow-up. */
    originOf,

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
      return db()
        .prepare("SELECT id FROM checks WHERE json_extract(verdict, '$.state') IN ('queued', 'running') ORDER BY rowid")
        .all()
        .map((row) => toOpenCheck(readCheck(db, toCheckId(row))));
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

    /**
     * Stores a running reviewer's findings, its earlier blocking findings answered not fixed among
     * them, and its answers on those (`earlier`), on the model bb ran it on, reported at `at`, in one
     * write, if it is still the review's running reviewer and the check still waits for it; says
     * whether it was.
     */
    receiveReview(checkId: CheckId, reviewerThreadId: string, { findings, earlier }: ReviewReport, model: ModelRef, at: number): boolean {
      return db().transaction(() => moveReview(db, checkId, { state: "running", reviewerThreadId }, { state: "reported", at, reviewerThreadId, findings, earlier, model }))();
    },

    /** Marks a running review's reviewer as given its scope, as when it was told it late, if it is still that review's running reviewer and the check still waits for it; says whether it was. */
    rescopeReview(checkId: CheckId, reviewerThreadId: string): boolean {
      return db().transaction(() => moveReview(db, checkId, { state: "running", reviewerThreadId }, { state: "running", reviewerThreadId, scoped: true }))();
    },

    /** Records that no review will be had, and why, as of `at`, if the review is still where `from` says and the check still waits for it; says whether it was. Its verifier starts next. */
    missReview(checkId: CheckId, from: ReviewFrom, reason: string, at: number): boolean {
      const reviewerThreadId = from.state === "running" ? from.reviewerThreadId : null;
      return db().transaction(() => moveReview(db, checkId, from, { state: "missed", at, reviewerThreadId, reason }))();
    },

    /** Gives up on a waiting check at `at`, with why, and records it checked for its regional manager, together, if it is still where `from` says; returns whose it was, or null when it had moved on. */
    giveUpCheck(checkId: CheckId, from: VerdictFrom, why: GivenUp, at: number): CoordinatorId | null {
      return db().transaction(() => {
        if (!moveVerdict(checkId, from, { state: "could-not-run", at, ...why })) return null;
        const { coordinatorId, issueId } = ownerOf(checkId);
        insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId, asked: null }, at);
        return coordinatorId;
      })();
    },

    /**
     * Stores a verifier's verdict, returned at `at` and not yet settled, if its verifier is still the
     * check's running one; says whether it was. Nobody is told until it is settled. why mustFixFails
     * is set here: every verdict returned now is judged by the must-fix rule; only the migration wrote false.
     */
    receiveVerdict(checkId: CheckId, verdict: ReceivedVerdict, at: number): boolean {
      return db().transaction(() => {
        const running = verdictOf(db, checkId);
        if (running?.state !== "running" || running.verifierThreadId !== verdict.verifierThreadId) return false;
        writeVerdict(db, checkId, { ...verdict, at, mustFixFails: true, settlement: { kind: "pending" } });
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
        writeSettlement(db, checkId, { kind: "sending-back", round: countFixRound(db, coordinatorId, handingAgentOf(checkId), 1), ci });
      })();
    },

    /**
     * Settles an unsettled verdict and records it for its regional manager, together. `sent-back`
     * and `maybe-sent-back` need a claimed round, and keep it and its CI; `checked` gives back a
     * round claimed for findings that never left. A failure at the issue's cap also puts the cap
     * question to the user, and a pass files its issue's follow-up, in the same transaction (askAtCap,
     * fileFollowUp); `merged` says whether the issue's pull request had merged as the settler judged
     * it (verify.ts stepOf), which closes the issue as it passes. `waiting-for-ci` moves a pending
     * verdict to wait, and records nothing: nobody is told until it settles. Returns whose it was,
     * or null when it was already settled or waiting, or there is no claim to keep.
     */
    settleReturned(checkId: CheckId, as: Settlement, at: number, merged: boolean): CoordinatorId | null {
      return db().transaction(() => {
        const verdict = unsettled(checkId);
        if (verdict === null) return null;
        const { settlement } = verdict;
        const { coordinatorId, issueId } = ownerOf(checkId);
        if (as.kind === "waiting-for-ci") {
          if (settlement.kind !== "pending") return null;
          writeSettlement(db, checkId, as);
          return coordinatorId;
        }
        if (as.kind === "checked") {
          if (settlement.kind === "sending-back") countFixRound(db, coordinatorId, handingAgentOf(checkId), -1);
          writeSettlement(db, checkId, as);
          insertEvent(db, coordinatorId, { kind: "checked", issueId, checkId, asked: askAtCap(coordinatorId, issueId, checkId, at) }, at);
          fileFollowUp(coordinatorId, issueId, checkId, merged, at);
          return coordinatorId;
        }
        if (settlement.kind !== "sending-back") return null;
        const { round, ci } = settlement;
        writeSettlement(db, checkId, { kind: as.kind, round, ci });
        // why no ask on a sent-back one: it went back only because the cap allowed it (verify.ts stepOf).
        insertEvent(db, coordinatorId, as.kind === "sent-back" ? { kind: "sent-back", issueId, agentId: handingAgentOf(checkId), checkId, round } : { kind: "checked", issueId, checkId, asked: askAtCap(coordinatorId, issueId, checkId, at) }, at);
        return coordinatorId;
      })();
    },

    /** The agent's checks that passed all but CI and wait for CI on their commit, oldest first. */
    waitingForCi: (coordinatorId: CoordinatorId, agentId: AgentId): CheckId[] => waitingForCi(db, coordinatorId, agentId),

    /** Every returned verdict not settled yet, oldest first: one waiting for CI, or one a crash or a reload stopped settling. */
    unsettledChecks(): CheckId[] {
      return db().prepare("SELECT id FROM checks WHERE json_extract(verdict, '$.settlement.kind') IN ('pending', 'sending-back', 'waiting-for-ci') ORDER BY rowid").all().map(toCheckId);
    },
  };
}

/**
 * How a pass closes its issue as it settles, as the issue's view will say (status.ts): a build
 * parent's passed final check closes it; a done handoff's pass, only once its pull request merged
 * (`merged`), and by that handoff; else it is still open.
 */
function closeOfPass({ id, subject }: Check, merged: boolean): Closure | null {
  switch (subject.kind) {
    case "final":
      return { by: "final-check", checkId: id };
    case "handoff":
      return merged ? { by: "handoff", handoffId: subject.handoffId } : null;
    default:
      return subject satisfies never;
  }
}

const verdictOf = (db: Db, checkId: CheckId): Verdict | null => readCheck(db, checkId)?.verdict ?? null;

/**
 * One check as its readers get it, or null when there is none by that id: read with every check of
 * its issue before it, oldest first, since a missed review's verdict triaged the findings of the
 * round before it that was reviewed (rounds/delta.ts readInOrder).
 */
function readCheck(db: Db, checkId: CheckId): Check | null {
  const row = db().prepare("SELECT coordinator_id AS coordinatorId, issue_id AS issueId, rowid AS seq FROM checks WHERE id = ?").get(checkId);
  if (row === undefined) return null;
  const { coordinatorId, issueId, seq } = z.object({ coordinatorId: coordinatorIdSchema, issueId: issueIdSchema, seq: z.number() }).parse(row);
  return storedChecks(db, coordinatorId, issueId, seq).at(-1) ?? null;
}

/** Every check of the issue, by its id, each read whole in one pass (rounds/delta.ts readInOrder). */
const issueChecks = (db: Db, coordinatorId: CoordinatorId, issueId: IssueId): Map<CheckId, Check> =>
  new Map(storedChecks(db, coordinatorId, issueId, Number.MAX_SAFE_INTEGER).map((check) => [check.id, check]));

/** The issue's checks up to the row `upTo`, oldest first, each read whole. */
function storedChecks(db: Db, coordinatorId: CoordinatorId, issueId: IssueId, upTo: number): Check[] {
  const rows = db().prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE coordinator_id = ? AND issue_id = ? AND rowid <= ? ORDER BY rowid`).all(coordinatorId, issueId, upTo);
  return readInOrder(rows.map((row): StoredCheck => checkRowSchema.parse(row)));
}

function writeVerdict(db: Db, checkId: CheckId, verdict: StoredVerdict): void {
  db().prepare("UPDATE checks SET verdict = ? WHERE id = ?").run(JSON.stringify(verdict), checkId);
}

/** Moves a returned verdict's settlement, and nothing else of it: the rest stays as it was stored. */
function writeSettlement(db: Db, checkId: CheckId, settlement: Returned["settlement"]): void {
  db().prepare("UPDATE checks SET verdict = json_set(verdict, '$.settlement', json(?)) WHERE id = ?").run(JSON.stringify(settlement), checkId);
}

const isAt = (verdict: Verdict, from: VerdictFrom): boolean =>
  from.state === "queued" ? verdict.state === "queued" : verdict.state === "running" && verdict.verifierThreadId === from.verifierThreadId;

const toCheckId = (row: unknown): CheckId => z.object({ id: checkIdSchema }).parse(row).id;

const CHECK_COLUMNS = "id, coordinator_id AS coordinatorId, issue_id AS issueId, at, criteria, verifier, subject, review, verdict, follow_up_id AS followUpId";
const checkRowSchema = z.object({
  id: checkIdSchema,
  coordinatorId: coordinatorIdSchema,
  issueId: issueIdSchema,
  at: z.number(),
  criteria: json(doneCriteriaSchema),
  verifier: nullableJson(executionSchema),
  subject: json(checkSubjectSchema),
  review: json(reviewSchema),
  verdict: json(storedVerdictSchema),
  followUpId: issueIdSchema.nullable(),
});
/** why throw: the query picks only final checks, by an id it just listed. */
function toFinalCheck(check: Check | null): FinalCheck {
  if (check === null) throw new Error("A listed final check is missing.");
  const { subject } = check;
  if (subject.kind !== "final") throw new Error(`The check ${check.id} is not a final check.`);
  return { ...check, subject };
}

/** why throw on null: the query just listed its id. */
function toOpenCheck(check: Check | null): OpenCheck {
  if (check === null) throw new Error("A listed open check is missing.");
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
