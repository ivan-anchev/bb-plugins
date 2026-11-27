import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { agentIdSchema } from "../../agent/agent.ts";
import { handoffIdSchema } from "../../agent/handoff.ts";
import { issueIdSchema } from "../../issue/issue.ts";
import { coordinatorIdSchema } from "../../role.ts";
import { checkIdSchema, type Check, type StoredCheck } from "../check.ts";
import type { Review, ReviewFinding } from "../review.ts";
import type { StoredVerdict } from "../verdict.ts";
import { deltaOf, readInOrder, triageList } from "./delta.ts";

type Triage = Extract<StoredVerdict, { state: "returned" }>["triage"][number];

const CAP: ReviewFinding = { title: "The backoff never caps", file: "src/retry.ts", line: 4, severity: "must-fix", claim: "The backoff never caps.", origin: "new" };
const FOUR_XX: ReviewFinding = { title: "A 4xx is retried", file: "src/retry.ts", line: 9, severity: "must-fix", claim: "A 4xx is retried.", origin: "new" };
const JITTER: ReviewFinding = { title: "The jitter is computed twice", file: "src/retry.ts", line: 12, severity: "should-fix", claim: "The jitter is computed twice.", origin: "new" };
const ANCHORED: Triage = { result: "anchored", anchor: "brief", steps: null, reason: "It grows without bound." };
const CONFIRMED: Triage = { result: "confirmed", reason: "Both calls on line 12." };
const REJECTED: Triage = { result: "rejected", reason: "It caps at 5 minutes." };

const sha = (n: number): string => String(n).repeat(40);

/** A check of a1's done handoff at commit `n`, as its row stores it, with `review` and `verdict`. */
function stored(n: number, review: Review, verdict: StoredVerdict): StoredCheck {
  return {
    id: checkIdSchema.parse(randomUUID()),
    coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
    issueId: issueIdSchema.parse("WEB-1"),
    at: 3_000 + n,
    criteria: ["npm test passes"],
    verifier: null,
    reviewer: null,
    subject: { kind: "handoff", agentId: agentIdSchema.parse("a1"), handoffId: handoffIdSchema.parse(randomUUID()), headSha: sha(n), prUrl: null, branch: null },
    review,
    verdict,
    followUpId: null,
    acceptedAt: null,
  };
}

/** A verdict on commit `n` that passed its criterion, with `triage`, settled. */
const returned = (n: number, triage: Triage[]): StoredVerdict => ({
  state: "returned",
  attachments: [],
  at: 5_000 + n,
  verifierThreadId: `thr_v${n}`,
  headSha: sha(n),
  checkout: { headSha: sha(n), changedFiles: [], changedFileCount: 0 },
  criteria: [{ criterion: "npm test passes", result: "pass", shows: "Ran it.", evidence: "ok" }],
  findings: [],
  blocking: [],
  triage,
  mustFixFails: true,
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
});

const reported = (findings: ReviewFinding[]): Review => ({ state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings, earlier: [], model: { providerId: "claude-code", model: "sonnet" } });
const MISSED: Review = { state: "missed", at: 4_000, reviewerThreadId: null, reason: "its reviewer stalled" };

/** A round whose review reported `findings` and whose verdict triaged them as `triage`. */
const reviewed = (n: number, findings: [ReviewFinding, Triage][]): StoredCheck =>
  stored(
    n,
    reported(findings.map(([finding]) => finding)),
    returned(
      n,
      findings.map(([, triage]) => triage),
    ),
  );

/** The issue's checks as the store reads them, each joined on the delta of the ones before it. */
const read = (...checks: StoredCheck[]): Check[] => readInOrder(checks);

test("deltaOf is first while no earlier round was both reviewed and judged: none at all, a missed review, or a reported one whose verdict hasn't returned", () => {
  assert.deepEqual(deltaOf([]), { kind: "first" });
  assert.deepEqual(deltaOf(read(stored(1, MISSED, returned(1, [])))), { kind: "first" }, "a missed review reviewed nothing");
  assert.deepEqual(deltaOf(read(stored(1, reported([CAP]), { state: "running", verifierThreadId: "thr_v", nudged: false, declined: [], checkout: null }))), { kind: "first" }, "its verdict is still to come");
  assert.deepEqual(deltaOf(read(stored(1, reported([CAP]), { state: "superseded" }))), { kind: "first" }, "a newer handoff replaced it before its verdict");
});

test("deltaOf takes its base from the latest round with a reported review and a returned verdict: its commit, the findings that failed it as blocking, and every other held finding as known", () => {
  const rounds = read(reviewed(1, [[CAP, ANCHORED]]), reviewed(2, [[FOUR_XX, ANCHORED], [JITTER, CONFIRMED], [{ ...CAP, line: 40, claim: "Too slow." }, REJECTED]]), stored(3, reported([]), { state: "superseded" }));
  const delta = deltaOf(rounds);
  assert.equal(delta.kind, "after");
  if (delta.kind !== "after") return;
  assert.equal(delta.base.id, rounds[1]?.id, "round 2, not round 3, whose verdict never returned");
  assert.equal(delta.base.subject.headSha, sha(2));
  assert.deepEqual(delta.blocking, [{ ...FOUR_XX, ...ANCHORED }], "only the finding that failed round 2's verdict");
  assert.deepEqual(delta.known, [{ ...CAP, ...ANCHORED }, { ...JITTER, ...CONFIRMED }], "round 1's held finding and round 2's confirmed one; never a rejected one");
});

test("deltaOf skips a round whose review was missed: its base stays the reviewed round before it, and the missed round's verdict triaged that round's blocking findings as unfixed", () => {
  const rounds = read(reviewed(1, [[CAP, ANCHORED], [JITTER, CONFIRMED]]), stored(2, MISSED, returned(2, [{ result: "anchored", anchor: "brief", steps: null, reason: "Still uncapped." }])));
  const delta = deltaOf(rounds);
  assert.equal(delta.kind === "after" && delta.base.id, rounds[0]?.id, "round 1: round 2's change was never reviewed");
  assert.deepEqual(delta.kind === "after" && delta.blocking, [{ ...CAP, ...ANCHORED }]);
  const missed = rounds[1]?.verdict;
  assert.deepEqual(missed?.state === "returned" && missed.triage, [{ ...CAP, origin: "unfixed", result: "anchored", anchor: "brief", steps: null, reason: "Still uncapped." }], "round 1's blocker, unfixed, is what round 2's verifier triaged");
  assert.deepEqual(
    triageList(MISSED, delta),
    [{ ...CAP, origin: "unfixed" }],
    "the list a missed round's verifier triages",
  );
});

test("deltaOf lists a finding held in several rounds once among the known ones, and never one that is blocking", () => {
  const delta = deltaOf(read(reviewed(1, [[JITTER, CONFIRMED], [CAP, ANCHORED]]), reviewed(2, [[JITTER, CONFIRMED], [{ ...CAP, origin: "unfixed" }, ANCHORED]])));
  assert.deepEqual(delta.kind === "after" && delta.known, [{ ...JITTER, ...CONFIRMED }], "the jitter once; the cap is round 2's blocker");
  assert.deepEqual(delta.kind === "after" && delta.blocking, [{ ...CAP, origin: "unfixed", ...ANCHORED }]);
});

test("a missed review's verdict returned before the delta existed, which triaged nothing, reads with nothing triaged though an earlier round blocked", () => {
  const rounds = read(reviewed(1, [[CAP, ANCHORED]]), stored(2, MISSED, returned(2, [])));
  const verdict = rounds[1]?.verdict;
  assert.deepEqual(verdict?.state === "returned" && verdict.triage, []);
});

test("an issue's long history reads whole: 60 reviewed rounds of 20 held findings each, every later one missed, read whole and give the last delta, every held finding once", () => {
  const findings = (round: number): [ReviewFinding, Triage][] =>
    Array.from({ length: 20 }, (_, i) => [{ ...(i === 0 ? CAP : JITTER), line: i + 1, claim: `Finding ${i} of round ${round}.` }, i === 0 ? ANCHORED : CONFIRMED]);
  const history = Array.from({ length: 60 }, (_, n) => (n % 2 === 0 ? reviewed(n, findings(n)) : stored(n, MISSED, returned(n, [{ result: "anchored", anchor: "brief", steps: null, reason: "Still." }]))));
  const delta = deltaOf(read(...history));
  assert.equal(delta.kind === "after" && delta.known.length, 30 * 20 - 1, "every held finding once, but round 58's blocker");
});
