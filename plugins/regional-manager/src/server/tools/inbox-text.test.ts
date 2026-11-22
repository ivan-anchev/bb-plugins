import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, type Agent } from "../../model/agent.ts";
import type { Execution } from "../../model/execution.ts";
import { handoffIdSchema, type Handoff } from "../../model/handoff.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import type { Handed } from "../../model/issue/status.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { checkIdSchema } from "../../model/verdict/check.ts";
import { outcome, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";
import { handoffText } from "./inbox-text.ts";

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

/** The handoff, checked with this verdict, on the issue that named `verifier` (null: none). */
const checkedWith = (verdict: Verdict, verifier: Execution | null = null): Handed => ({
  handoff,
  check: {
    id: checkIdSchema.parse("5d6c1e0a-2b3f-4a5e-8c7d-9e0f1a2b3c4d"),
    coordinatorId,
    issueId,
    at: 1_000,
    criteria: ["npm test passes"],
    verifier,
    subject: { kind: "handoff", agentId, handoffId: handoff.id, headSha: SHA, prUrl: null },
    review: { state: "none" },
    verdict,
  },
});

/** a1, as stored when it handed off, on `execution`. */
const agentOn = (execution: Execution) => ({ agents: (): Agent[] => [{ id: agentId, coordinatorId, issueId, placement: { kind: "worktree" }, base: { kind: "default" }, execution, threadId: "thr_a1", checkout: { environmentId: null, branch: null, head: null }, fixRounds: 0, startedAt: 1_000, ended: null }] });

const returned = (results: CriterionResult[], ranOn: Pick<Execution, "providerId" | "model"> = { providerId: "codex", model: "gpt-default" }, sameModel = false): Extract<Verdict, { state: "returned" }> => ({
  state: "returned",
  verifierThreadId: "thr_v",
  headSha: SHA,
  checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
  criteria: results.map((result) => ({ criterion: "npm test passes", result, evidence: "ran npm test" })),
  findings: [],
  triage: [],
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
