import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, type Agent } from "../agent.ts";
import { handoffIdSchema, type Handoff } from "../handoff.ts";
import { coordinatorIdSchema } from "../role.ts";
import { checkIdSchema, type Check } from "../verdict/check.ts";
import type { PrSnapshot } from "../verdict/pr.ts";
import type { CriterionResult, Verdict } from "../verdict/verdict.ts";
import { issueIdSchema, type Issue } from "./issue.ts";
import { issueViews, placedByLeft, type Handed, type HolderThread, type IssueFacts, type IssueStatus } from "./status.ts";

const coordinatorId = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
const issue: Issue = {
  id: issueIdSchema.parse("i1"),
  coordinatorId,
  kind: "build",
  title: "Add retries to the webhook sender",
  description: "Failed webhook deliveries are lost.",
  brief: "Retry failed deliveries with backoff.",
  doneCriteria: ["npm test passes"],
  verifier: null,
  rest: "todo",
  dependsOn: [],
  closed: null,
  createdAt: 1_000,
};
const agent: Agent = {
  id: agentIdSchema.parse("a1"),
  coordinatorId,
  issueId: issue.id,
  placement: { kind: "worktree" },
  base: { kind: "default" },
  execution: { providerId: "codex", model: "gpt-5.4", reasoningLevel: "medium" },
  threadId: "thr_a1",
  checkout: { environmentId: null, branch: null, head: null },
  fixRounds: 0,
  startedAt: 2_000,
  ended: null,
};
const SHA = "a".repeat(40);
const CLEAN = { headSha: SHA, changedFiles: [], changedFileCount: 0 };
const report = { summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
const made = { id: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), coordinatorId, issueId: issue.id, agentId: agent.id, at: 5_000, turnSeq: 7 };
const done: Handoff = { ...made, ...report, status: "done", delivery: { kind: "commit", headSha: SHA, prUrl: null } };
const blocked: Handoff = { ...made, ...report, status: "blocked", summary: "Needs a staging key" };

const checkOf = (verdict: Verdict): Check => ({
  id: checkIdSchema.parse("5d6c1e0a-2b3f-4a5e-8c7d-9e0f1a2b3c4d"),
  coordinatorId,
  issueId: issue.id,
  at: 5_000,
  criteria: issue.doneCriteria,
  verifier: null,
  subject: { kind: "handoff", agentId: agent.id, handoffId: done.id, headSha: SHA, prUrl: null },
  verdict,
});
const returned = (results: CriterionResult[], settlement: Extract<Verdict, { state: "returned" }>["settlement"] = { kind: "checked", refused: null, ci: { kind: "none" } }): Extract<Verdict, { state: "returned" }> => ({
  state: "returned",
  verifierThreadId: "thr_v",
  headSha: SHA,
  checkout: CLEAN,
  criteria: results.map((result) => ({ criterion: "npm test passes", result, evidence: "npm test" })),
  findings: [],
  model: { providerId: "claude-code", model: "sonnet" },
  sameModel: false,
  settlement,
});
const pr = (state: PrSnapshot["state"]): PrSnapshot => ({ number: 12, url: "https://github.com/o/r/pull/12", state, draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] });

const thread = (status: HolderThread["status"], hasPendingInteraction = false): HolderThread => ({ status, hasPendingInteraction });
const facts = (over: Partial<IssueFacts>): IssueFacts => ({ issue, holder: null, ended: null, pr: null, openDecision: false, ...over });
const held = (thread: HolderThread | null, current: Handed | null = null, fixRounds = 0): Partial<IssueFacts> => ({ holder: { agent: { ...agent, fixRounds }, thread, current } });
const view = (over: Partial<IssueFacts>) => {
  const [placed] = issueViews([facts(over)]);
  return placed === undefined ? assert.fail("no view") : { status: placed.status, headline: placed.headline, needsYou: placed.needsYou };
};
const at = (status: IssueStatus, headline: string, needsYou: string | null = null) => ({ status, headline, needsYou });

test("an issue no agent's work places rests where the manager put it", () => {
  assert.deepEqual(view({}), at("todo", "Not started"));
  assert.deepEqual(view({ issue: { ...issue, rest: "backlog" } }), at("backlog", "Not planned"));
});

test("a closed issue is Canceled or Done as the manager closed it, whatever its agent does", () => {
  assert.deepEqual(view({ issue: { ...issue, closed: { as: "canceled", at: 9_000 } }, ...held(thread("active")) }), at("canceled", "Canceled"));
  assert.deepEqual(view({ issue: { ...issue, closed: { as: "accepted", at: 9_000 } } }), at("done", "Accepted"));
});

test("a merged pull request makes the issue Done, even while its check is pending or failed", () => {
  assert.deepEqual(view({ ...held(thread("idle"), { handoff: done, check: checkOf({ state: "queued", checkout: CLEAN }) }), pr: pr("merged") }), at("done", "Merged #12"));
  assert.deepEqual(view({ ...held(thread("idle"), { handoff: done, check: checkOf(returned(["fail"])) }), pr: pr("merged") }), at("done", "Merged #12"));
});

test("an issue whose agent's thread runs is In progress, and Needs you when the thread waits on the user or failed", () => {
  for (const status of ["pending", "starting", "active", "stopping"] as const) assert.equal(view(held(thread(status))).status, "in-progress", status);
  assert.deepEqual(view(held(thread("active"))), at("in-progress", "Working"));
  assert.deepEqual(view(held(thread("idle"))), at("in-progress", "Its turn ended without a handoff"));
  assert.deepEqual(view(held(null)), at("in-progress", "Its thread is gone"));
  const waiting = "Waiting for an answer or an approval in its thread";
  assert.deepEqual(view(held(thread("active", true))), at("in-progress", waiting, waiting));
  assert.deepEqual(view(held(thread("error"), { handoff: done, check: null })), at("in-progress", "Its last turn failed", "Its last turn failed"));
});

test("an agent bb never confirmed a thread for flags its issue, saying what to do", () => {
  const unconfirmed = "No thread: bb never confirmed starting one. agent_stop ends the agent at once; then agent_start again";
  assert.deepEqual(view({ holder: { agent: { ...agent, threadId: null }, thread: null, current: null } }), at("in-progress", unconfirmed, unconfirmed));
});

test("a thread status newer than this plugin's SDK reads as idle, never throws", () => {
  // why the cast: it stands in for a status a newer bb sends, which this SDK's type can't name.
  const fromNewerHost = { status: "hibernating", hasPendingInteraction: false } as unknown as HolderThread;
  assert.deepEqual(view(held(fromNewerHost)), at("in-progress", "Its turn ended without a handoff"));
});

test("a blocked handoff flags the issue In progress", () => {
  assert.deepEqual(view(held(thread("idle"), { handoff: blocked, check: null })), at("in-progress", "Blocked: Needs a staging key", "Blocked: Needs a staging key"));
});

test("a done handoff walks Verifying, then In review, by its check", () => {
  const summary = "Retries land with backoff";
  const cases: [Verdict, ReturnType<typeof at>][] = [
    [{ state: "queued", checkout: CLEAN }, at("verifying", `Verifying: ${summary}`)],
    [{ state: "running", verifierThreadId: "thr_v", nudged: false, checkout: CLEAN }, at("verifying", `Verifying: ${summary}`)],
    [returned(["pass"], { kind: "waiting-for-ci" }), at("verifying", `Waiting for CI: ${summary}`)],
    [returned(["pass"]), at("in-review", `✓ Verified: ${summary}`)],
    [{ state: "waived" }, at("in-review", `Unverified: ${summary}`)],
    [returned(["fail"], { kind: "sent-back", round: 1, ci: { kind: "none" } }), at("in-progress", `Fixing its verifier's findings: ${summary}`)],
    [returned(["fail"]), at("in-progress", `✗ Failed verification: ${summary}`, `✗ Failed verification: ${summary}`)],
    [{ state: "could-not-run", verifierThreadId: null, reason: "unread" }, at("in-progress", `Couldn't verify: ${summary}`, `Couldn't verify: ${summary}`)],
    [{ state: "superseded" }, at("in-progress", `Replaced by a newer handoff: ${summary}`)],
  ];
  for (const [verdict, expected] of cases) assert.deepEqual(view(held(thread("idle"), { handoff: done, check: checkOf(verdict) })), expected, JSON.stringify(verdict));
});

test("a failure the plugin's checkout read made leads its headline with that, though every criterion passed", () => {
  const dirty: Verdict = { ...returned(["pass"]), checkout: { headSha: SHA, changedFiles: ["?? scratch.txt"], changedFileCount: 1 } };
  const headline = "✗ Not the claimed commit on a clean tree after its fix round: Retries land with backoff";
  assert.deepEqual(view(held(thread("idle"), { handoff: done, check: checkOf(dirty) }, 1)), at("in-progress", headline, headline));
});

test("a failure after the agent's fix round says so, and one whose findings may not have reached it says that instead", () => {
  const summary = "Retries land with backoff";
  const failed = `✗ Failed verification after its fix round: ${summary}`;
  assert.deepEqual(view(held(thread("idle"), { handoff: done, check: checkOf(returned(["fail"])) }, 1)), at("in-progress", failed, failed));
  const unsure = `✗ Failed verification, its findings may or may not have reached it: ${summary}`;
  assert.deepEqual(view(held(thread("idle"), { handoff: done, check: checkOf(returned(["fail"], { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } })) }, 1)), at("in-progress", unsure, unsure));
});

test("work that reached Verifying or In review stays there once its agent ended; anything short of it rests again", () => {
  const stopped = (left: Handed) => ({ ended: { how: "stopped", left } }) as const;
  assert.deepEqual(view(stopped({ handoff: done, check: checkOf({ state: "queued", checkout: CLEAN }) })), at("verifying", "Verifying: Retries land with backoff"));
  assert.deepEqual(view({ ...stopped({ handoff: done, check: checkOf(returned(["pass"])) }), pr: pr("open") }), at("in-review", "✓ Verified: Retries land with backoff"));
  assert.deepEqual(view(stopped({ handoff: done, check: checkOf(returned(["fail"])) })), at("todo", "Its agent was stopped"));
  assert.equal(placedByLeft("build", { handoff: blocked, check: null }, null), null);
});

test("an issue resting in Todo after its agent ended says how it ended; only one no agent ever started reads Not started", () => {
  assert.deepEqual(view({}), at("todo", "Not started"));
  for (const how of ["stopped", "archived", "deleted"] as const) assert.deepEqual(view({ ended: { how, left: null } }), at("todo", `Its agent was ${how}`), how);
  assert.deepEqual(view({ ended: { how: "spawn-failed", left: null } }), at("todo", "bb never started its agent's thread"));
  assert.deepEqual(view({ issue: { ...issue, rest: "backlog" }, ended: { how: "stopped", left: null } }), at("backlog", "Not planned"));
});

test("an issue named by an unanswered decision Needs you, unless something more pressing does", () => {
  const asked = "Waiting on your answer to its decision";
  assert.deepEqual(view({ openDecision: true }), at("todo", "Not started", asked));
  assert.deepEqual(view({ openDecision: true, ...held(thread("active")) }), at("in-progress", "Working", asked));
  assert.deepEqual(view({ openDecision: true, ...held(thread("idle"), { handoff: blocked, check: null }) }), at("in-progress", "Blocked: Needs a staging key", "Blocked: Needs a staging key"));
});
