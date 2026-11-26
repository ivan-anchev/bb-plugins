import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, type Agent } from "../../model/agent/agent.ts";
import type { Execution } from "../../model/agent/execution.ts";
import { handoffIdSchema, type Handoff } from "../../model/agent/handoff.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import type { Handed } from "../../model/issue/status.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { checkIdSchema } from "../../model/verdict/check.ts";
import type { Review } from "../../model/verdict/review.ts";
import { outcome, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";
import { handoffText, updatesText, type Lookups } from "./inbox-text.ts";
import type { StoredEvent } from "../../model/inbox/inbox-event.ts";
import type { Check } from "../../model/verdict/check.ts";
import type { PrSnapshot } from "../../model/verdict/pr.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const coordinatorId = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
const issueId = issueIdSchema.parse("WEB-1");
const agentId = agentIdSchema.parse("a1");
const CODEX: Execution = { providerId: "codex", model: "gpt-5.4", reasoningLevel: "medium" };
const OPUS: Execution = { providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high" };

const handoff: Handoff = {
  id: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"),
  coordinatorId,
  issueId,
  agentId,
  at: 1_000,
  turnSeq: 1,
  status: "done",
  summary: "Retries land with backoff",
  did: [],
  evidence: [],
  concerns: [],
  deviations: [],
  findings: [],
  delivery: { kind: "commit", headSha: SHA, prUrl: null },
};

/** The handoff, checked with this verdict after `review`, on the issue that named `verifier` (null: none). */
const checkedWith = (verdict: Verdict, verifier: Execution | null = null, review: Review = { state: "none" }): Handed => ({
  handoff,
  check: {
    id: checkIdSchema.parse("5d6c1e0a-2b3f-4a5e-8c7d-9e0f1a2b3c4d"),
    coordinatorId,
    issueId,
    at: 1_000,
    criteria: ["npm test passes"],
    verifier,
    subject: { kind: "handoff", agentId, handoffId: handoff.id, headSha: SHA, prUrl: null },
    review,
    verdict,
    followUpId: null,
    acceptedAt: null,
  },
});

/** a1, as stored when it handed off, on `execution`. */
const agentOn = (execution: Execution) => ({ agents: (): Agent[] => [{ id: agentId, coordinatorId, issueId, placement: { kind: "worktree" }, base: { kind: "default" }, execution, threadId: "thr_a1", checkout: { environmentId: null, branch: null, head: null }, fixRounds: 0, startedAt: 1_000, ended: null }] });

const returned = (results: CriterionResult[], ranOn: Pick<Execution, "providerId" | "model"> = { providerId: "codex", model: "gpt-default" }, sameModel = false): Extract<Verdict, { state: "returned" }> => ({
  state: "returned", at: 5_000,
  verifierThreadId: "thr_v",
  headSha: SHA,
  checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
  criteria: results.map((result) => ({ criterion: "npm test passes", result, evidence: "ran npm test" })),
  findings: [],
  blocking: [],
  triage: [],
  mustFixFails: true,
  model: { providerId: ranOn.providerId, model: ranOn.model },
  sameModel,
  settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
});

test("a returned verdict reads Verified in catch-up exactly when outcome() passes it, with its count beside", () => {
  const cases: [CriterionResult[], number][] = [
    [["pass"], 1],
    [["pass", "pass"], 2],
    [["pass", "fail"], 1],
    [["pass", "unverifiable"], 1],
    [["unverifiable"], 0],
    [["fail", "fail"], 0],
  ];
  for (const [results, passed] of cases) {
    const verdict = returned(results);
    const label = outcome(verdict) === "pass" ? "Verified" : "Failed verification";
    assert.match(handoffText(checkedWith(verdict), agentOn(CODEX)), new RegExp(`#### Verdict\\n\\n${label}: ${passed} of ${results.length} criteria passed,`), results.join(", "));
  }
});

test("a verdict the plugin's checkout read or CI failed leads with that, before a count of criteria that may all have passed", () => {
  const dirty: Verdict = { ...returned(["pass"]), checkout: { headSha: SHA, changedFiles: ["?? scratch.txt"], changedFileCount: 1 } };
  assert.match(
    handoffText(checkedWith(dirty), agentOn(CODEX)),
    new RegExp(`#### Verdict\\n\\nFailed verification: not the claimed commit on a clean tree\\. 1 of 1 criteria passed, checked at ${SHA} by a verifier on codex gpt-default\\. bb's git plugin read the agent's environment as it handed off: the working tree had 1 changed file: \\?\\? scratch\\.txt\\.`),
  );  const ciFailed: Verdict = { ...dirty, settlement: { kind: "checked", refused: null, ci: { kind: "fail", number: 41, failedChecks: ["test"] } } };
  assert.match(handoffText(checkedWith(ciFailed), agentOn(CODEX)), /#### Verdict\n\nFailed verification: not the claimed commit on a clean tree, and CI failed on #41\. 1 of 1 criteria passed, /);
});

test("a verdict says what its verifier ran on: as named on the issue, why not the one named, or that it was the agent's own", () => {
  const by = (handed: Handed, agentRan: Execution) => /by a verifier on (.*?)\. bb's git plugin/.exec(handoffText(handed, agentOn(agentRan)))?.[1];
  assert.equal(by(checkedWith(returned(["pass"], OPUS), OPUS), CODEX), "claude-code claude-opus-5-5, as named on WEB-1");
  assert.equal(by(checkedWith(returned(["pass"], { providerId: "claude-code", model: "sonnet" }), CODEX), CODEX), "claude-code sonnet, not the codex gpt-5.4 named on WEB-1: a1 did the work on it");
  assert.equal(by(checkedWith(returned(["pass"], { providerId: "codex", model: "gpt-default" }), OPUS), CODEX), "codex gpt-default, not the claude-code claude-opus-5-5 named on WEB-1: bb can't run it in a1's environment");
  assert.equal(by(checkedWith(returned(["pass"], CODEX, true)), CODEX), "codex gpt-5.4, a1's own model, as no other was available");
  assert.equal(by(checkedWith(returned(["pass"])), CODEX), "codex gpt-default");
});

test("a verdict's review says whether the findings that fail it reached the agent only as far as its settlement shows", () => {
  const review: Review = { state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings: [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap.", origin: "new" }], earlier: [], model: { providerId: "claude-code", model: "sonnet" } };
  const failed: Extract<Verdict, { state: "returned" }> = { ...returned(["fail"]), triage: [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap.", origin: "new", result: "anchored", anchor: "criterion", steps: null, reason: "It never caps." }] };
  const cases: [Extract<Verdict, { state: "returned" }>["settlement"], string][] = [
    [{ kind: "pending" }, "None has gone to the agent yet."],
    [{ kind: "waiting-for-ci" }, "None has gone to the agent yet."],
    [{ kind: "sending-back", round: 1, ci: { kind: "none" } }, "The ones that fail it are on their way back to the agent with the failed verdict."],
    [{ kind: "sent-back", round: 1, ci: { kind: "none" } }, "The ones that fail it went back to the agent with the failed verdict."],
    [{ kind: "maybe-sent-back", round: 1, ci: { kind: "none" } }, "The ones that fail it went with the failed verdict's findings, which may or may not have reached the agent."],
    [{ kind: "checked", refused: null, ci: { kind: "none" } }, "None of them went to the agent."],
    [{ kind: "superseded" }, "None of them went to the agent."],
  ];
  for (const [settlement, line] of cases) {
    const text = handoffText(checkedWith({ ...failed, settlement }, null, review), agentOn(CODEX));
    assert.ok(text.includes(`Review: a reviewer on claude-code sonnet reported 1 finding; the verifier anchored 1, downgraded 0, confirmed 0 and rejected 0. ${line}`), settlement.kind);
  }
});

test("catch-up words a round's review as the verifier's totals, anchored, downgraded, confirmed and rejected, then each finding in the review's order with its triage: what an anchored one breaks, a downgraded one's new severity", () => {
  const findings = [
    { file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap.", origin: "new" },
    { file: "src/retry.ts", line: 9, severity: "must-fix", claim: "The name says nothing.", origin: "new" },
    { file: "src/retry.ts", line: 12, severity: "should-fix", claim: "Jitter computed twice.", origin: "new" },
    { file: "src/retry.css", line: null, severity: "nit", claim: "Padding.", origin: "new" },
  ] as const;
  const triage = [
    { result: "anchored", anchor: "brief", steps: null, reason: "The brief says capped." },
    { result: "downgraded", to: "nit", reason: "Breaks none of the five." },
    { result: "confirmed", reason: "Both calls on line 12." },
    { result: "rejected", reason: "Matches the row." },
  ] as const;
  const review: Review = { state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings: [...findings], earlier: [], model: { providerId: "claude-code", model: "sonnet" } };
  const verdict: Extract<Verdict, { state: "returned" }> = {
    ...returned(["pass"]),
    settlement: { kind: "sent-back", round: 1, ci: { kind: "none" } },
    triage: findings.map((finding, i) => ({ ...finding, ...(triage[i] ?? assert.fail("no triage")) })),
  };
  const text = handoffText(checkedWith(verdict, null, review), agentOn(CODEX));
  assert.ok(
    text.includes(
      [
        "Review: a reviewer on claude-code sonnet reported 4 findings; the verifier anchored 1, downgraded 1, confirmed 1 and rejected 1. The ones that fail it went back to the agent with the failed verdict. The others don't go back to the agent: when the issue passes, they are filed as a follow-up, unless every one is a nit.",
        "- `src/retry.ts:4` (must-fix): No cap.\n  Anchored, as it breaks a requirement the issue's brief states explicitly: The brief says capped.\n- `src/retry.ts:9` (must-fix): The name says nothing.\n  Downgraded to nit: Breaks none of the five.\n- `src/retry.ts:12` (should-fix): Jitter computed twice.\n  Confirmed: Both calls on line 12.\n- `src/retry.css` (nit): Padding.\n  Rejected: Matches the row.",
      ].join("\n\n"),
    ),
    text,
  );
  assert.match(text, /Failed verification: a must-fix review finding upheld\. 1 of 1 criteria passed/, "the anchored finding alone fails it");
});

/** What catch-up looks up for WEB-1, whose record is `record`, and its follow-up WEB-2, titled as filed. */
const lookupsOf = (record: readonly Handed[]): Lookups => ({
  titles: new Map([[issueId, "Add retries"], [FOLLOW_UP, "Follow-ups from WEB-1: Add retries"]]),
  handoff: (id) => record.find((one) => one.handoff.id === id) ?? null,
  check: (id) => record.find((one) => one.check?.id === id)?.check ?? null,
  ...agentOn(CODEX),
  decision: () => null,
  comment: () => null,
  record: () => record,
  view: () => null,
  capQuestions: () => [],
});

const FOLLOW_UP = issueIdSchema.parse("WEB-2");
const LOG_IT = { file: "src/retry.ts", line: 10, severity: "should-fix", claim: "Log each retry.", origin: "new" } as const;
const NAME_IT = { file: "src/retry.ts", line: 3, severity: "nit", claim: "Name the constant.", origin: "new" } as const;

/** A check of the handoff whose reviewer reported `findings`, each of which the verifier confirmed, with every criterion `result`, stamped with `followUpId`. */
function confirmedAll(findings: (typeof LOG_IT | typeof NAME_IT)[], result: CriterionResult, followUpId: Check["followUpId"] = null): Handed {
  const review: Review = { state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings: [...findings], earlier: [], model: { providerId: "claude-code", model: "sonnet" } };
  const handed = checkedWith({ ...returned([result]), triage: findings.map((finding) => ({ ...finding, result: "confirmed", reason: "It holds." })) }, null, review);
  return { ...handed, check: handed.check === null ? null : { ...handed.check, followUpId } };
}

test("catch-up's pass line names the follow-up its settling filed, and the round's review says its findings are filed there", () => {
  const passed = confirmedAll([LOG_IT, NAME_IT], "pass", FOLLOW_UP);
  const checkId = passed.check?.id ?? assert.fail("no check");
  const event: StoredEvent = { id: 1, at: 5_000, event: { kind: "checked", issueId, checkId, asked: null } };
  const text = updatesText([event], lookupsOf([passed]));
  assert.match(text, /\n\nIt passed, so the plugin filed every review finding its rounds held without blocking it as WEB-2 "Follow-ups from WEB-1: Add retries", top-level in Backlog and depending on WEB-1: agent_start on it is refused while WEB-1 is open\./);
  assert.match(text, /confirmed 2 and rejected 0\. They are filed in WEB-2, its follow-up\./);

  assert.doesNotMatch(updatesText([event], lookupsOf([confirmedAll([], "pass")])), /filed/, "a pass that filed nothing says nothing of a follow-up");
  const nitOnly = confirmedAll([NAME_IT], "pass");
  const nitText = updatesText([{ ...event, event: { kind: "checked", issueId, checkId: nitOnly.check?.id ?? assert.fail("no check"), asked: null } }], lookupsOf([nitOnly]));
  assert.match(nitText, /confirmed 1 and rejected 0\. They don't go back to the agent, and its pass filed no follow-up, as every finding left was a nit: they stay in the issue's feed\./, "a pass with only a nit left says nothing was filed");
  assert.doesNotMatch(nitText, /It passed, so the plugin filed/);
});

test("catch-up's merge line says how many held findings no follow-up collected, and says nothing when a follow-up collected them all", () => {
  const pr: PrSnapshot = { number: 41, url: "https://github.com/o/r/pull/41", state: "merged", draft: false, review: "none", ci: "pass", failedChecks: [], headSha: SHA };
  const merged: StoredEvent = { id: 2, at: 6_000, event: { kind: "pr", issueId, agentId, pr, changes: ["merged"] } };
  const failedEarlier = confirmedAll([LOG_IT, NAME_IT], "fail");
  const nitLeft = confirmedAll([NAME_IT], "pass");
  assert.match(updatesText([merged], lookupsOf([failedEarlier, nitLeft])), /It merged with 3 review findings its rounds held that no follow-up collected\. Nothing is filed for them now; they stay in the issue's feed\./);
  assert.match(updatesText([merged], lookupsOf([nitLeft])), /It merged with 1 review finding its rounds held that no follow-up collected\. Nothing is filed for it now; it stays in the issue's feed\./);
  const collected = [confirmedAll([LOG_IT, NAME_IT], "fail", FOLLOW_UP), confirmedAll([], "pass", FOLLOW_UP)];
  assert.doesNotMatch(updatesText([merged], lookupsOf(collected)), /no follow-up collected/);
  const opened: StoredEvent = { ...merged, event: { kind: "pr", issueId, agentId, pr: { ...pr, state: "open" }, changes: ["opened"] } };
  assert.doesNotMatch(updatesText([opened], lookupsOf([nitLeft])), /no follow-up collected/, "only a merge counts them");
});

test("catch-up's merge line counts a held finding that failed the latest verdict, when nothing fixed it before the merge", () => {
  const pr: PrSnapshot = { number: 41, url: "https://github.com/o/r/pull/41", state: "merged", draft: false, review: "none", ci: "pass", failedChecks: [], headSha: SHA };
  const merged: StoredEvent = { id: 2, at: 6_000, event: { kind: "pr", issueId, agentId, pr, changes: ["merged"] } };
  const blocker = { file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap.", origin: "new" } as const;
  const review: Review = { state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings: [blocker], earlier: [], model: { providerId: "claude-code", model: "sonnet" } };
  const failed = checkedWith({ ...returned(["pass"]), triage: [{ ...blocker, result: "anchored", anchor: "criterion", steps: null, reason: "It never caps." }] }, null, review);
  assert.match(updatesText([merged], lookupsOf([failed])), /It merged with 1 review finding its rounds held that no follow-up collected\./);
  const stillToSettle = checkedWith({ ...returned(["pass"]), settlement: { kind: "pending" }, triage: [{ ...blocker, result: "anchored", anchor: "criterion", steps: null, reason: "It never caps." }] }, null, review);
  assert.match(updatesText([merged], lookupsOf([stillToSettle])), /It merged with 1 review finding its rounds held that no follow-up collected\./, "a merge read after the triage is recorded, before its settlement, counts it too");
});

test("a pass settled before follow-ups, with a should-fix left and no follow-up, is told without a reason the plugin can't give", () => {
  const passed = confirmedAll([LOG_IT, NAME_IT], "pass");
  const text = handoffText(passed, agentOn(CODEX));
  assert.match(text, /They didn't go back to the agent, and its pass filed no follow-up\./);
  assert.doesNotMatch(text, /every finding left was a nit/);
});

test("a build parent's final check that passed names the follow-up its settling filed", () => {
  const final: Check = { ...(confirmedAll([], "pass").check ?? assert.fail("no check")), subject: { kind: "final", defaultBranch: "main", merged: [] }, review: { state: "none" }, followUpId: FOLLOW_UP };
  const event: StoredEvent = { id: 3, at: 7_000, event: { kind: "checked", issueId, checkId: final.id, asked: null } };
  const lookups = { ...lookupsOf([]), check: () => final };
  assert.match(updatesText([event], lookups), /It passed, so the plugin filed every review finding its rounds held without blocking it as WEB-2 "Follow-ups from WEB-1: Add retries"/);
});
