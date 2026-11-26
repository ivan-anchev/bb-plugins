import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../server.ts";
import { coordinatorContract } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import { upgradeMemoryFrom040 } from "../memory/memory-upgrade.ts";
import { coordinating, harness, HEAD, isRefusal, ISSUE, issueIn, newSubmission, settled, startedAgent, textOf, type FakePr } from "../test-harness.ts";


const NOTES = memoryFileSchema.parse("NOTES.md");

async function started() {
  const kit = harness();
  const { threadId } = await kit.startManager("Migrate the webhook service");
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  return { kit, threadId, coordinatorId: role.coordinatorId, dir: kit.memory.of(role.coordinatorId).dir };
}

/** The version a catch-up shows for a file, as the agent would read it off. */
const versionIn = (text: string, file: string): string | undefined => new RegExp(`^## ${file.replace(".", "\\.")} \\(version (\\w+)\\)$`, "m").exec(text)?.[1];

test("a file written with crew_memory_write is in the next catch-up and in the board Memory's reads", async () => {
  const { kit, threadId, coordinatorId } = await started();
  const before = textOf(await kit.call("crew_catch_up", {}, threadId));

  const plan = "# Notes\n\n1. Inventory the endpoints\n";
  assert.match(textOf(await kit.call("crew_memory_write", { file: "NOTES.md", content: plan, baseVersion: versionIn(before, "NOTES.md") }, threadId)), /^Saved NOTES\.md, now version \w+\.$/);
  assert.equal(textOf(await kit.call("crew_memory_write", { file: "notes/api.md", content: "# API\n", baseVersion: null }, threadId)), `Saved notes/api.md, now version ${kit.memory.of(coordinatorId).read(memoryFileSchema.parse("notes/api.md")).text?.version}.`);

  const after = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(after, /## NOTES\.md \(version \w+\)\n\n# Notes\n\n1\. Inventory the endpoints/);
  assert.match(after, /Other memory files, read each with crew_memory_read: notes\/api\.md\./);

  const long = `# Log\n\n${"Delivered once. ".repeat(400)}`;
  await kit.call("crew_memory_write", { file: "notes/log.md", content: long, baseVersion: null }, threadId);
  const files = kit.memory.of(coordinatorId);
  // why every key: the board reads each, and a preview is the file's first 2,000 characters, not all of it.
  assert.deepEqual((await kit.rpc.memoryList({ coordinatorId })).files.slice(-2), [
    { file: "notes/api.md", preview: "# API\n", modifiedAt: files.modifiedAt(memoryFileSchema.parse("notes/api.md")) },
    { file: "notes/log.md", preview: long.slice(0, 2_000), modifiedAt: files.modifiedAt(memoryFileSchema.parse("notes/log.md")) },
  ]);
  assert.equal((await kit.rpc.memoryRead({ coordinatorId, file: NOTES })).text?.content, plan);
  assert.deepEqual(kit.memoryWrites().slice(-2), [coordinatorId, coordinatorId], "each write refreshes the editor");
});

test("a Coordinator write from before the user's save is refused with the user's text, and its merge then saves", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const read = versionIn(textOf(await kit.call("crew_catch_up", {}, threadId)), "NOTES.md");
  const userRead = (await kit.rpc.memoryRead({ coordinatorId, file: NOTES })).text;
  assert.equal(userRead?.version, read);
  const saved = await kit.rpc.memoryWrite({ coordinatorId, file: NOTES, content: "# Notes\n\n1. The user's step\n", baseVersion: read ?? null });
  assert.equal(saved.outcome, "saved");

  const refused = await kit.call("crew_memory_write", { file: "NOTES.md", content: "# Notes\n\n1. The Coordinator's step\n", baseVersion: read }, threadId);
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /changed since you read it/);
  assert.match(textOf(refused), /## NOTES\.md \(version \w+\)\n\n# Notes\n\n1\. The user's step/);
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), "# Notes\n\n1. The user's step\n");

  const merged = "# Notes\n\n1. The user's step\n2. The Coordinator's step\n";
  assert.ok(!isRefusal(await kit.call("crew_memory_write", { file: "NOTES.md", content: merged, baseVersion: versionIn(textOf(refused), "NOTES.md") }, threadId)));
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), merged);
});

test("the editor's save from a stale read is refused too, and the Coordinator's text is kept", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const userRead = (await kit.rpc.memoryRead({ coordinatorId, file: NOTES })).text;
  await kit.call("crew_memory_write", { file: "NOTES.md", content: "# Notes\n\nThe Coordinator's plan\n", baseVersion: userRead?.version ?? null }, threadId);

  const outcome = await kit.rpc.memoryWrite({ coordinatorId, file: NOTES, content: "# Notes\n\nThe user's plan\n", baseVersion: userRead?.version ?? null });
  assert.equal(outcome.outcome, "conflict");
  assert.equal(outcome.outcome === "conflict" ? outcome.current.text?.content : undefined, "# Notes\n\nThe Coordinator's plan\n");
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), "# Notes\n\nThe Coordinator's plan\n");
});

test("crew_memory_write from a thread that is not a Coordinator is refused and writes nothing", async () => {
  const { kit, coordinatorId, dir } = await started();
  const plan = readFileSync(join(dir, "NOTES.md"), "utf8");

  for (const file of ["NOTES.md", "notes/api.md"]) {
    const result = await kit.call("crew_memory_write", { file, content: "# Taken over\n", baseVersion: null }, "thr_forged");
    assert.ok(isRefusal(result));
    assert.match(textOf(result), /crew_memory_write is refused/);
  }
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), plan);
  assert.deepEqual(kit.memory.of(coordinatorId).list(), ["MEMORY.md", "GOAL.md", "NOTES.md", "RULES.md", "CREW.md"]);
});

test("after the upgrade from 0.4, each file it renamed or dropped is refused by name on read and write, naming what replaced it, and none is written", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  // A 0.4 memory: PLAN.md becomes NOTES.md, PREFERENCES.md becomes RULES.md, DIGEST.md goes.
  unlinkSync(join(dir, "NOTES.md"));
  unlinkSync(join(dir, "RULES.md"));
  writeFileSync(join(dir, "PLAN.md"), "# Plan\n\n1. Inventory the endpoints\n");
  writeFileSync(join(dir, "PREFERENCES.md"), "# Preferences\n\n- 2026-11-02: build on codex gpt-5.4\n");
  writeFileSync(join(dir, "DIGEST.md"), "# Digest\n\nAll quiet.\n");
  upgradeMemoryFrom040(kit.memory, [coordinatorId]);
  const files = kit.memory.of(coordinatorId).list();
  assert.deepEqual([...files].sort(), ["CREW.md", "GOAL.md", "MEMORY.md", "NOTES.md", "RULES.md"]);
  const notes = readFileSync(join(dir, "NOTES.md"), "utf8");
  assert.match(notes, /1\. Inventory the endpoints/);

  const gone = {
    "PLAN.md": "PLAN.md is now NOTES.md: use NOTES.md instead.",
    "PREFERENCES.md": "PREFERENCES.md is now RULES.md: use RULES.md instead.",
    "DIGEST.md": "DIGEST.md is retired: your reply to the user is the summary.",
  };
  for (const [file, refusal] of Object.entries(gone)) {
    const read = await kit.call("crew_memory_read", { file }, threadId);
    const written = await kit.call("crew_memory_write", { file, content: "# Plan\n\n1. Retry\n", baseVersion: null }, threadId);
    assert.ok(isRefusal(read) && isRefusal(written), file);
    assert.equal(textOf(read), refusal);
    assert.equal(textOf(written), refusal);
  }

  assert.deepEqual(kit.memory.of(coordinatorId).list(), files);
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), notes);
});

test("a 0.4 PLAN.md the upgrade left beside an existing NOTES.md still reads, and is refused on write", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const leftover = "# Plan\n\n1. Inventory the endpoints\n";
  writeFileSync(join(dir, "PLAN.md"), leftover);
  upgradeMemoryFrom040(kit.memory, [coordinatorId]);
  const files = kit.memory.of(coordinatorId).list();
  assert.deepEqual([...files].sort(), ["CREW.md", "GOAL.md", "MEMORY.md", "NOTES.md", "PLAN.md", "RULES.md"]);

  const read = await kit.call("crew_memory_read", { file: "PLAN.md" }, threadId);
  assert.ok(!isRefusal(read));
  assert.match(textOf(read), /1\. Inventory the endpoints/);
  const written = await kit.call("crew_memory_write", { file: "PLAN.md", content: "# Plan\n\n1. Retry\n", baseVersion: null }, threadId);
  assert.ok(isRefusal(written));
  assert.equal(textOf(written), "PLAN.md is now NOTES.md: use NOTES.md instead.");

  assert.deepEqual(kit.memory.of(coordinatorId).list(), files);
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), leftover);
});

test("crew_memory_write and the editor's save reject a name outside the memory folder or not markdown", async () => {
  const { kit, threadId, coordinatorId } = await started();

  for (const file of ["../x.md", "/etc/x.md", "notes.txt", "notes/../../data.md"]) {
    await assert.rejects(kit.call("crew_memory_write", { file, content: "x", baseVersion: null }, threadId), /memory file is a \.md path inside the memory folder/, file);
    assert.equal(coordinatorContract.memoryWrite.input.safeParse({ coordinatorId, file, content: "x", baseVersion: null }).success, false, file);
  }
});

test("the Memory editor's reads and writes refuse a coordinating thread that was never started", async () => {
  const { kit } = await started();
  const unknown = { coordinatorId: coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000000") };

  assert.throws(() => kit.rpc.memoryList(unknown), /no started regional manager/);
  assert.throws(() => kit.rpc.memoryWrite({ ...unknown, file: NOTES, content: "x", baseVersion: null }), /no started regional manager/);
});

test("a catch-up past its budget names the files it left out", async () => {
  const { kit, threadId, dir } = await started();
  writeFileSync(join(dir, "NOTES.md"), "x".repeat(45_000));

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(text, /## GOAL\.md/);
  assert.doesNotMatch(text, /## NOTES\.md/);
  assert.match(text, /Not shown, to keep this short: NOTES\.md\./);
});

test("crew_end_turn repeats the manager's reason and says its turn is over, and leaves the thread running, unstopped and unmessaged", async () => {
  const { kit, threadId } = await started();
  const reason = "BBP-4's CI passed; its agent is still shipping it";
  const sent = kit.sent().length;

  const result = await kit.call("crew_end_turn", { reason }, threadId);

  assert.ok(!isRefusal(result));
  assert.equal(textOf(result), `${reason}\n\nYour turn is over. Write nothing more: no text, no whitespace and no other tool call.`);
  // why active: the manager calls it mid-turn, and a stop would leave the thread idle.
  assert.equal(kit.thread(threadId).status, "active");
  assert.equal(kit.sent().length, sent);
});

test("crew_end_turn is the regional manager's alone: an agent and a verifier are refused it", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId);
  await kit.call("agent_handoff", { status: "done", summary: "Did it", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verdict = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check?.verdict;
  const verifierThreadId = verdict?.state === "running" ? verdict.verifierThreadId : assert.fail("no verifier running");

  for (const thread of [agentThreadId, verifierThreadId]) {
    assert.ok(!kit.configurationFor(thread, {}).tools.includes("crew_end_turn"), `${thread} is not offered it`);
    const result = await kit.call("crew_end_turn", { reason: "Nothing new" }, thread);
    assert.ok(isRefusal(result), thread);
    assert.match(textOf(result), /crew_end_turn is refused: only a regional manager can use it/);
  }
});

test("the plugin loads in the SDK's fake host, which checks every tool's parameters as bb does", () => {
  const { bb, harness: host } = createFakePluginHost();
  plugin(bb);
  assert.deepEqual(
    new Set(host.registrations.agentTools.map(({ name }) => name)),
    new Set(["crew_catch_up", "crew_memory_read", "crew_memory_write", "crew_remind", "crew_ask_user", "crew_end_turn", "issue_create", "issue_update", "issue_read", "agent_start", "agent_message", "agent_stop", "agent_handoff", "issue_comment", "issue_review", "issue_verdict"]),
  );
});

/** The update crew_catch_up gives for the user's comment `text` on `issueId`, posted from the issue's tab, and the comment's id. */
async function commentCaughtUp(kit: Awaited<ReturnType<typeof coordinating>>["kit"], threadId: string, coordinatorId: CoordinatorId, issueId: string, text: string) {
  await kit.call("crew_catch_up", {}, threadId);
  const { commentId } = await kit.rpc.commentIssue({ coordinatorId, issueId: issueIdSchema.parse(issueId), text, replyTo: null, submission: newSubmission() });
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  return { commentId, update: caughtUp.slice(caughtUp.indexOf("### "), caughtUp.indexOf("## Board")) };
}

const RELAY_WAIT =
  "Never relay while a check of its agent's handoff is in flight (Reviewing or Verifying, or a done handoff its agent made while its turn still runs): a message drops that check or cuts across it. Read the agent's issue with issue_read just before you relay: it says when a check is in flight, and gives every comment on it whole, by its id. To relay later, set a reminder with crew_remind naming the issue and the comment's id, and relay once issue_read shows no check in flight.";
const IN_FLIGHT = "A check on its record is in flight: its verdict is still to come or to settle, or it waits for CI (see Its record). Message its agent only once it has settled: a message drops it or cuts across it.";
const DONE_HANDOFF = { status: "done", summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD };

test("the user's comment on an issue an agent holds offers a relay to that agent, naming the comment, and says to read the issue's check first", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue } = await startedAgent(kit, threadId);
  const { commentId, update } = await commentCaughtUp(kit, threadId, coordinatorId, issue, "Cap retries at five?");
  assert.ok(update.includes(`Nothing reaches a1 on its own: the user's comments come to you. Reply on the issue with issue_comment (issue "${issue}", replyTo "${commentId}")`), update);
  assert.ok(update.includes(`or, when it concerns a1's work, relay it to a1 with agent_message, quoting their words and naming ${commentId}, so it can answer on the issue. ${RELAY_WAIT}`), update);
  assert.ok(!textOf(await kit.call("issue_read", { id: issue }, threadId)).includes(IN_FLIGHT), "no check is in flight, as the read shows");
  assert.equal(textOf(await kit.call("agent_message", { agent: "a1", text: `The user asks (${commentId}): "Cap retries at five?"` }, threadId)), "Sent to a1.");
});

test("the user's comment on an issue whose done handoff's check is queued says not to relay now, though its agent's turn still runs and the board shows it In progress", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await kit.call("agent_handoff", DONE_HANDOFF, agentThreadId);
  const { update } = await commentCaughtUp(kit, threadId, coordinatorId, issue, "Cap retries at five?");
  assert.ok(update.includes(`Don't relay it to a1 now: a check of its handoff is in flight, and a message drops it or cuts across it. Only if it concerns a1's work, relay it to a1`), update);
  assert.ok(update.includes(RELAY_WAIT), "a relay after the check, too, waits on a fresh issue_read");
  assert.ok(update.includes(`${issue} is In progress now, while its check is in flight.`), update);
  assert.ok(textOf(await kit.call("issue_read", { id: issue }, threadId)).includes(IN_FLIGHT), "the read the guidance names shows the check in flight");
});

test("the user's comment on an issue whose verdict waits for CI says not to relay, and issue_read shows the check in flight until CI settles it", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  kit.thread(threadId).status = "idle";
  const branch = kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch");
  const pr: FakePr = { number: 44, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "PENDING", failed: [] };
  kit.github.prs.set(branch, pr);
  await kit.call("agent_handoff", { ...DONE_HANDOFF, prUrl: "https://github.com/acme/webhooks/pull/44" }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await kit.tick();
  const running = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check?.verdict;
  const verifierThreadId = running?.state === "running" ? running.verifierThreadId : assert.fail("no verifier running");
  await kit.call("issue_verdict", { criteria: [{ criterion: 1, result: "pass", shows: "Ran it.", evidence: "$ npm test\n# pass 13" }], findings: [] }, verifierThreadId);
  await settled();
  const waiting = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check?.verdict;
  assert.equal(waiting?.state === "returned" && waiting.settlement.kind, "waiting-for-ci");

  const { update } = await commentCaughtUp(kit, threadId, coordinatorId, issue, "Cap retries at five?");
  assert.ok(update.includes("Don't relay it to a1 now: a check of its handoff is in flight") && update.includes(`${issue} is Verifying now, while its check is in flight.`), update);
  assert.ok(textOf(await kit.call("issue_read", { id: issue }, threadId)).includes(IN_FLIGHT), "the fresh read shows it in flight too");

  kit.github.prs.set(branch, { ...pr, rollup: "SUCCESS" });
  await kit.tick();
  await settled();
  assert.ok(!textOf(await kit.call("issue_read", { id: issue }, threadId)).includes(IN_FLIGHT), "settled: the read no longer holds a relay back");
});

test("the user's comment while bb's thread list can't be read still says a check is in flight, and asks for a fresh issue_read before any relay", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await kit.call("agent_handoff", DONE_HANDOFF, agentThreadId);
  await kit.call("crew_catch_up", {}, threadId);
  await kit.rpc.commentIssue({ coordinatorId, issueId: issueIdSchema.parse(issue), text: "Cap retries at five?", replyTo: null, submission: newSubmission() });
  kit.threadLists.failure = new Error("HTTP 503: bb is restarting");
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  const update = caughtUp.slice(caughtUp.indexOf("### "), caughtUp.indexOf("## Board"));
  assert.ok(update.includes(`Where ${issue} stands, and whether an agent holds it, couldn't be read with the board, but a check on its record is in flight, so don't relay it to an agent now. ${RELAY_WAIT}`), update);
  kit.threadLists.failure = null;
  assert.ok(textOf(await kit.call("issue_read", { id: issue }, threadId)).includes(IN_FLIGHT), "the read it names shows the check in flight");
});

test("a relay put off for a check keeps the comment: once its catch-up is spent, issue_read gives it whole by its id, and a reminder can name it", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await kit.call("agent_handoff", DONE_HANDOFF, agentThreadId);
  const text = "Cap retries at five.\n\nAnd log each one.";
  const { commentId } = await commentCaughtUp(kit, threadId, coordinatorId, issue, text);
  await kit.call("issue_comment", { issue, text: "Noted; I'll pass it on once the check is done.", replyTo: commentId }, threadId);
  assert.ok(!textOf(await kit.call("crew_catch_up", {}, threadId)).includes(text), "the update came once");

  const read = textOf(await kit.call("issue_read", { id: issue }, threadId));
  assert.ok(read.includes(`### Comments\n\n#### ${commentId}, the user's, at `), read);
  assert.ok(read.includes(`\n\n${text}\n\n#### m2, yours, at `) && read.includes(`, answering ${commentId}\n\nNoted; I'll pass it on once the check is done.`), read);
  assert.match(textOf(await kit.call("crew_remind", { note: `relay ${commentId} on ${issue} to a1 once its check settles`, at: "in 30m" }, threadId)), /^Set r1, due /);
});

test("the user's comment on an issue no agent holds points at the brief of the agent started on it, never at a relay", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const issue = issueIn(textOf(await kit.call("issue_create", ISSUE, threadId)));
  const { update } = await commentCaughtUp(kit, threadId, coordinatorId, issue, "Cap retries at five?");
  assert.ok(update.includes(`or put it in the brief of the agent you start on it. ${issue} is Todo now, and no agent holds it.`), update);
  assert.ok(!update.includes("agent_message"), update);
});

test("the user's comment on a parent points at the sub-issue it concerns, never at an agent of the parent, and that step works", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const parent = issueIn(textOf(await kit.call("issue_create", { ...ISSUE, title: "Webhook delivery" }, threadId)));
  const sub = issueIn(textOf(await kit.call("issue_create", { ...ISSUE, parent }, threadId)));
  const { update } = await commentCaughtUp(kit, threadId, coordinatorId, parent, "Retries first, then dead letters.");
  assert.ok(update.includes("or put it in the brief of the sub-issue it concerns. An agent already on that sub-issue gets it only as a relay with agent_message") && update.includes("a parent has no agent of its own."), update);
  assert.ok(!update.includes("Nothing reaches") && !update.includes("the agent you start on it"), "no agent of the parent to relay to or start");
  assert.ok(!isRefusal(await kit.call("issue_update", { id: sub, brief: "Retries first, then dead letters (the user's comment)." }, threadId)));
});

test("the user's comment on a parent whose sub-issue has an agent: that agent answers on its own sub-issue, and the manager replies on the parent, as the update says", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const parent = issueIn(textOf(await kit.call("issue_create", { ...ISSUE, title: "Webhook delivery" }, threadId)));
  const { issue: sub, agentThreadId } = await startedAgent(kit, threadId, { parent });
  const { commentId, update } = await commentCaughtUp(kit, threadId, coordinatorId, parent, "Retries first, then dead letters.");
  assert.ok(update.includes(`It can't comment on ${parent}: ask it to answer with issue_comment on its own sub-issue, and once its answer reaches you, reply to the user on ${parent} with issue_comment (replyTo "${commentId}").`), update);

  assert.equal(textOf(await kit.call("agent_message", { agent: "a1", text: "The user says: \"Retries first, then dead letters.\" Answer on your own issue." }, threadId)), "Sent to a1.");
  assert.match(textOf(await kit.call("issue_comment", { issue: sub, text: "Retries land first." }, agentThreadId)), /^Posted m2 on /);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), new RegExp(`${sub} "Add retries" \\(a1\\) commented: m2\n\nAt [^\n]+ In its own words:\n\nRetries land first\\.`));
  assert.match(textOf(await kit.call("issue_comment", { issue: parent, text: "Retries land first, then dead letters.", replyTo: commentId }, threadId)), /^Posted m3 on /);
});

test("the user's comment on a closed issue points at a new issue, never at an agent of it, and that step works", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const issue = issueIn(textOf(await kit.call("issue_create", ISSUE, threadId)));
  await kit.call("issue_update", { id: issue, status: "canceled" }, threadId);
  const { update } = await commentCaughtUp(kit, threadId, coordinatorId, issue, "We still need retries, just later.");
  assert.ok(update.includes(`or file what it asks for as a new issue with issue_create. ${issue} is Canceled now, so no agent can start on it.`), update);
  assert.ok(!update.includes("agent_message") && !update.includes("the agent you start on it"), update);
  assert.match(textOf(await kit.call("issue_create", { ...ISSUE, title: "Retries, later" }, threadId)), /^Filed /);
});
