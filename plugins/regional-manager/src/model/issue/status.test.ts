import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, type Agent } from "../agent/agent.ts";
import { handoffIdSchema, type Handoff } from "../agent/handoff.ts";
import { coordinatorIdSchema } from "../role.ts";
import { checkIdSchema, type Check, type FinalCheck } from "../verdict/check.ts";
import type { PrSnapshot } from "../verdict/pr.ts";
import type { CriterionResult, Verdict } from "../verdict/verdict.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { issueIdSchema, type Issue } from "./issue.ts";
import { issueViews, placedByLeft, type Handed, type HolderThread, type IssueFacts, type IssueStatus } from "./status.ts";

const coordinatorId = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
const issue: Issue = {
  id: issueIdSchema.parse("WEB-1"),
  coordinatorId,
  kind: "build",
  title: "Add retries to the webhook sender",
  description: "Failed webhook deliveries are lost.",
  brief: "Retry failed deliveries with backoff.",
  doneCriteria: ["npm test passes"],
  verifier: null,
  rest: "todo",
  parentId: null,
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
  review: { state: "none" },
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
  triage: [],
  settlement,
});
const pr = (state: PrSnapshot["state"]): PrSnapshot => ({ number: 12, url: "https://github.com/o/r/pull/12", state, draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] });

const thread = (status: HolderThread["status"], hasPendingInteraction = false): HolderThread => ({ status, hasPendingInteraction });
const facts = (over: Partial<IssueFacts>): IssueFacts => ({ issue, holder: null, ended: null, pr: null, openDecision: false, finalCheck: null, verifierAsks: false, ...over });
const held = (thread: HolderThread | null, current: Handed | null = null, fixRounds = 0): Partial<IssueFacts> => ({ holder: { agent: { ...agent, fixRounds }, thread, current } });
const view = (over: Partial<IssueFacts>) => {
  const [placed] = issueViews([facts(over)]);
  return placed === undefined ? assert.fail("no view") : { status: placed.status, headline: placed.headline, needsYou: placed.needsYou };
};
const at = (status: IssueStatus, headline: string | null, needsYou: string | null = null) => ({ status, headline, needsYou });

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
    [{ state: "running", verifierThreadId: "thr_v", nudged: false, declined: [], checkout: CLEAN }, at("verifying", `Verifying: ${summary}`)],
    [returned(["pass"], { kind: "waiting-for-ci" }), at("verifying", `Waiting for CI: ${summary}`)],
    [returned(["pass"]), at("in-review", `✓ Verified: ${summary}`)],
    [{ state: "waived" }, at("in-review", `Unverified: ${summary}`)],
    [returned(["fail"], { kind: "sent-back", round: 1, ci: { kind: "none" } }), at("in-progress", `Fixing its verifier's findings: ${summary}`)],
    [returned(["fail"]), at("in-progress", `✗ Failed verification: ${summary}`, `✗ Failed verification: ${summary}`)],
    [{ state: "could-not-run", verifierThreadId: null, reason: "unread" }, at("in-progress", `Couldn't verify, as unread: ${summary}`, `Couldn't verify, as unread: ${summary}`)],
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
  assert.equal(placedByLeft("build", { handoff: blocked, check: null }, { pr: null, verifierAsks: false }), null);
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

/** A parent WEB-1 of `kind` and its sub-issues WEB-2, WEB-3…, each placed by the facts given, viewed together; `own`, the parent's facts beside its issue. */
function family(kind: Issue["kind"], subIssues: Partial<IssueFacts>[], parent: Partial<Issue> = {}, own: Partial<IssueFacts> = {}) {
  const parentFacts = facts({ ...own, issue: { ...issue, kind, ...parent } });
  const subFacts = subIssues.map((over, i) => facts({ ...over, issue: { ...issue, kind: "build", ...over.issue, id: issueIdSchema.parse(`WEB-${i + 2}`), parentId: issue.id } }));
  const [placed, ...subs] = issueViews([parentFacts, ...subFacts]);
  return placed === undefined ? assert.fail("no view") : { parent: placed, subs };
}
const rolled = (kind: Issue["kind"], subIssues: Partial<IssueFacts>[], parent: Partial<Issue> = {}) => {
  const { parent: placed } = family(kind, subIssues, parent);
  return { status: placed.status, headline: placed.headline, needsYou: placed.needsYou };
};
const resting = (rest: Issue["rest"]): Partial<IssueFacts> => ({ issue: { ...issue, rest } });
const closedAs = (as: "canceled" | "accepted", kind: Issue["kind"] = "build"): Partial<IssueFacts> => ({ issue: { ...issue, kind, closed: { as, at: 9_000 } } });
const reported = (at: number): Partial<IssueFacts> => ({ issue: { ...issue, kind: "research" }, ...held(thread("idle"), { handoff: { ...done, at, delivery: { kind: "report", report: "Use Stripe.", file: memoryFileSchema.parse("reports/WEB-2.md") } }, check: null }) });

test("a parent's headline says only what its count of Done sub-issues doesn't: nothing, or why it Needs you", () => {
  const asked = "Waiting on your answer to its decision";
  assert.deepEqual(rolled("build", [resting("todo")]), at("todo", null));
  const [parent = assert.fail("no view")] = issueViews([facts({ openDecision: true }), facts({ issue: { ...issue, id: issueIdSchema.parse("WEB-2"), parentId: issue.id } })]);
  assert.deepEqual({ status: parent.status, headline: parent.headline, needsYou: parent.needsYou }, at("todo", asked, asked));
});

test("a parent rolls up from its sub-issues: any started is In progress, any in Todo or the parent resting there Todo, else Backlog", () => {
  assert.deepEqual(rolled("build", [resting("todo"), resting("backlog")]), at("todo", null));
  assert.deepEqual(rolled("build", [resting("backlog"), held(thread("active"))]), at("in-progress", null));
  assert.deepEqual(rolled("build", [resting("backlog")], { rest: "backlog" }), at("backlog", null));
  assert.deepEqual(rolled("build", [resting("backlog")]), at("todo", null), "the parent rests in Todo");
  assert.deepEqual(rolled("build", [closedAs("canceled"), closedAs("canceled")], { rest: "backlog" }), at("backlog", null), "every sub-issue canceled");
  assert.deepEqual(rolled("build", [closedAs("canceled")]), at("todo", null));
  assert.deepEqual(rolled("build", [{ openDecision: false }], { closed: { as: "canceled", at: 9_000 } }), at("canceled", "Canceled"));
  const { parent, subs } = family("build", [held(thread("idle"), { handoff: blocked, check: null }), resting("todo")]);
  assert.deepEqual([parent.status, parent.needsYou, parent.subIssues, parent.holder], ["in-progress", null, { done: 0, total: 2 }, null], "a flagged sub-issue flags itself, not its parent");
  assert.equal(subs[0]?.needsYou, "Blocked: Needs a staging key");
});

test("once every sub-issue is closed and one is Done: a research parent is Done, by its sub-issues' closes; a build parent's final check is due once all are merged", () => {
  const research = family("research", [reported(6_000), { pr: pr("merged") }, closedAs("canceled", "research")]);
  assert.deepEqual([research.parent.status, research.parent.headline, research.parent.closedBy], [
    "done",
    null,
    { by: "sub-issues", closes: [{ by: "handoff", handoffId: done.id }, { by: "merge", number: 12 }, { by: "manager", as: "canceled" }] },
  ]);
  assert.deepEqual(rolled("research", [reported(6_000), resting("todo")]), at("in-progress", null));

  assert.deepEqual(rolled("build", [{ pr: pr("merged") }, closedAs("canceled"), reported(6_000)]), at("verifying", "Final check due"));
  assert.deepEqual(family("build", [{ pr: pr("merged") }, closedAs("canceled"), reported(6_000)]).parent.finalCheckDue, ["WEB-2"], "due on the Done build sub-issue's merged work only");
  const flag = "WEB-2 isn't merged, so WEB-1's work isn't all on the default branch";
  assert.deepEqual(rolled("build", [closedAs("accepted"), { pr: pr("merged") }]), at("in-progress", flag, flag));
  assert.deepEqual(rolled("build", [closedAs("accepted")], { closed: { as: "accepted", at: 9_100 } }), at("done", "Accepted"), "the manager accepted it");
});

/** A final check of WEB-1 on main, judging the work of `merged`, with `verdict`. */
const finalCheck = (merged: string[], verdict: Verdict): FinalCheck => ({
  ...checkOf(verdict),
  id: checkIdSchema.parse("7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"),
  subject: { kind: "final", defaultBranch: "main", merged: merged.map((id) => issueIdSchema.parse(id)) },
  review: { state: "none" },
});

test("a build parent whose work is all merged is placed by its latest final check, which is due again only for merged work it didn't judge", () => {
  const merged = (n: number): Partial<IssueFacts>[] => Array.from({ length: n }, () => ({ pr: pr("merged") }));
  const placed = (latest: FinalCheck | null, subIssues = merged(2), parent: Partial<Issue> = {}) => {
    const { status, headline, needsYou, finalCheckDue: due, closedBy } = family(parent.kind ?? "build", subIssues, parent, { finalCheck: latest }).parent;
    return { status, headline, needsYou, due, closedBy };
  };
  const at2 = (status: IssueStatus, headline: string, needsYou: string | null = null) => ({ status, headline, needsYou });
  const pick = ({ status, headline, needsYou }: ReturnType<typeof placed>) => ({ status, headline, needsYou });

  assert.deepEqual(placed(null), { ...at2("verifying", "Final check due"), due: ["WEB-2", "WEB-3"], closedBy: null }, "none made yet");
  assert.deepEqual(pick(placed(finalCheck(["WEB-2", "WEB-3"], { state: "queued", checkout: null }))), at2("verifying", "Final check running"));
  assert.deepEqual(pick(placed(finalCheck(["WEB-2", "WEB-3"], { state: "running", verifierThreadId: "thr_v", nudged: false, declined: [], checkout: null }))), at2("verifying", "Final check running"));
  const passed = finalCheck(["WEB-2", "WEB-3"], returned(["pass"]));
  assert.deepEqual(placed(passed), { ...at2("done", "✓ Final check passed"), due: null, closedBy: { by: "final-check", checkId: passed.id } });
  assert.deepEqual(pick(placed(finalCheck(["WEB-2", "WEB-3"], returned(["fail"])))), at2("in-progress", "✗ Final check failed", "✗ Final check failed"));
  assert.deepEqual(pick(placed(finalCheck(["WEB-2", "WEB-3"], { state: "could-not-run", verifierThreadId: "thr_v", reason: "its verifier stopped without a verdict twice" }))), at2("in-progress", "Couldn't run its final check, as its verifier stopped without a verdict twice", "Couldn't run its final check, as its verifier stopped without a verdict twice"));
  assert.deepEqual(pick(placed(finalCheck(["WEB-2", "WEB-3"], { state: "waived" }))), at2("in-review", "Unverified: verification was off"));

  const failedBefore = finalCheck(["WEB-2", "WEB-3"], returned(["fail"]));
  assert.deepEqual(placed(failedBefore, [...merged(2), held(thread("active"))]).status, "in-progress", "a fix filed and at work");
  assert.deepEqual(placed(failedBefore, merged(3)), { ...at2("verifying", "Final check due"), due: ["WEB-2", "WEB-3", "WEB-4"], closedBy: null }, "the fix merged: due again on all the merged work");
  assert.deepEqual(pick(placed(failedBefore, [...merged(2), reported(6_000)])), at2("in-progress", "✗ Final check failed", "✗ Final check failed"), "a research sub-issue since puts no new work on the default branch");
  assert.deepEqual(pick(placed(failedBefore, [...merged(2), closedAs("canceled")])), at2("in-progress", "✗ Final check failed", "✗ Final check failed"), "nor does a canceled one");

  const none = "WEB-1 has no done-criteria for its final check";
  assert.deepEqual(placed(null, merged(2), { doneCriteria: [] }), { ...at2("in-progress", none, none), due: null, closedBy: null });
  assert.deepEqual(placed(null, [{ pr: pr("merged") }], { kind: "research" }).status, "done", "a research parent never has one");
});

test("a sub-issue is blocked by its parent's dependencies, and its own", () => {
  const i9 = facts({ issue: { ...issue, id: issueIdSchema.parse("WEB-9") } });
  const parent = facts({ issue: { ...issue, dependsOn: [issueIdSchema.parse("WEB-9")] } });
  const sub = facts({ issue: { ...issue, id: issueIdSchema.parse("WEB-2"), parentId: issue.id } });
  const [i1View, i2View] = issueViews([parent, sub, i9]);
  assert.deepEqual([i1View?.blockedBy, i2View?.blockedBy], [[{ id: "WEB-9", status: "todo" }], [{ id: "WEB-9", status: "todo" }]]);
  assert.deepEqual(issueViews([parent, sub, { ...i9, issue: { ...i9.issue, closed: { as: "canceled", at: 9_000 } } }])[1]?.blockedBy, []);
});

test("a running verifier asking a person reads so while it waits, on a handoff's check and a final check; a check not yet running never does", () => {
  const summary = "Retries land with backoff";
  const running: Verdict = { state: "running", verifierThreadId: "thr_v", nudged: false, declined: [], checkout: CLEAN };
  const asking = ", its verifier asking for an answer or an approval, which the plugin declines";
  assert.deepEqual(view({ ...held(thread("idle"), { handoff: done, check: checkOf(running) }), verifierAsks: true }), at("verifying", `Verifying${asking}: ${summary}`));
  assert.deepEqual(view({ ...held(thread("idle"), { handoff: done, check: checkOf({ state: "queued", checkout: CLEAN }) }), verifierAsks: true }), at("verifying", `Verifying: ${summary}`));
  const merged = Array.from({ length: 2 }, () => ({ pr: pr("merged") }));
  const final = finalCheck(["WEB-2", "WEB-3"], { ...running, checkout: null });
  assert.equal(family("build", merged, {}, { finalCheck: final, verifierAsks: true }).parent.headline, `Final check running${asking}`);
});
