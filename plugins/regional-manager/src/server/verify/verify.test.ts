import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { z } from "zod";
import { handoffIdSchema } from "../../model/handoff.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { outcome, type Verdict } from "../../model/verdict/verdict.ts";
import { memoryStorage } from "../memory-storage.ts";
import { bbHttpError, coordinating, HEAD, isRefusal, settled, startedAgent, textOf, threadIn, type SendFailure } from "../test-harness.ts";

const a1 = agentIdSchema.parse("a1");
const i1 = issueIdSchema.parse("i1");
const CRITERIA = ["npm test passes", "npm run lint prints no errors"];
const DONE = {
  status: "done",
  summary: "Retries land with backoff",
  did: ["Added exponential backoff"],
  evidence: ["npm test: 12 passing, trust me"],
  concerns: [],
  deviations: [],
  findings: [],
  headSha: HEAD,
};
const PASSES = {
  criteria: [
    { criterion: 1, result: "pass", evidence: "$ npm test\n# pass 13\n# fail 0" },
    { criterion: 2, result: "pass", evidence: "$ npm run lint\n0 problems" },
  ],
  findings: [],
};
const FAILS = {
  ...PASSES,
  criteria: [
    { criterion: 1, result: "fail", evidence: "$ npm test\nnot ok 13 - backoff caps at 6000\n  expected: 6000\n  actual: 5000\n# fail 1" },
    { criterion: 2, result: "pass", evidence: "$ npm run lint\n0 problems" },
  ],
};

/** A regional manager with one agent, both idle, so a doorbell starts the regional manager's turn. */
async function withAgent(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  const agentThreadId = (await startedAgent(kit, threadId, { title: "Add retries", brief: "Retry failed deliveries with backoff.", doneCriteria: CRITERIA })).agentThreadId;
  kit.thread(threadId).status = "idle";
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  const row = async () => {
    const issue = (await kit.rpc.board({ coordinatorId })).issues[0] ?? assert.fail("no row");
    return { ...issue, lane: laneOf(issue) };
  };
  /** The issue opened on the board. */
  const opened = () => kit.rpc.issue({ coordinatorId, issueId: i1 });
  const latest = () => kit.store.latestHandoff(coordinatorId, a1) ?? assert.fail("no handoff");
  /** The check of the agent's latest handoff. */
  const check = () => latest().check ?? assert.fail(`the handoff is ${latest().handoff.status}`);
  const verdict = (): Verdict => check().verdict;
  const verifier = (): string => {
    const current = verdict();
    return current.state === "running" ? current.verifierThreadId : assert.fail(`the verdict is ${current.state}`);
  };
  const settlement = () => {
    const current = verdict();
    return current.state === "returned" ? current.settlement : assert.fail(`the verdict is ${current.state}`);
  };
  /** The agent hands off as done and ends its turn. */
  async function handOff(): Promise<string> {
    const answer = textOf(await kit.call("agent_handoff", DONE, agentThreadId));
    await kit.idle(agentThreadId, "Handed off.");
    await settled();
    return answer;
  }
  return { kit, threadId, coordinatorId, agentThreadId, doorbells, row, opened, latest, check, verdict, verifier, settlement, handOff };
}

test("a done handoff starts a hidden verifier as the agent's child, in its environment, on another provider, with no inherited choices", async () => {
  const { kit, threadId, agentThreadId, verifier, handOff } = await withAgent();
  assert.match(await handOff(), /A verifier now checks your commit/);
  const { spawnedWith, providerId, execution } = kit.thread(verifier());

  assert.equal(spawnedWith.visibility, "hidden");
  assert.equal(spawnedWith.parentThreadId, agentThreadId);
  assert.equal(spawnedWith.lifecycleOwnerThreadId, threadId);
  assert.equal(spawnedWith.parentNotifications, "off");
  assert.deepEqual(spawnedWith.environment, { type: "reuse", environmentId: kit.thread(agentThreadId).environmentId });
  assert.equal("executionInputSources" in spawnedWith, false);
  // why bb's record, not the request: bb drops what it doesn't count, and the agent runs on claude-code / opus.
  assert.deepEqual([providerId, execution?.model, execution?.permissionMode], ["codex", "gpt-default", "auto"]);
  assert.equal(kit.configurationFor(verifier(), {}).tools?.join(), "crew_memory_read,issue_verdict");
  assert.ok(kit.configurationFor(verifier(), {}).skills?.includes("verifying"));
});

test("a verifier's brief holds the claimed commit, the plugin's read of it, and every criterion numbered, and none of the agent's own report", async () => {
  const { kit, verifier, handOff } = await withAgent();
  await handOff();
  const prompt = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, new RegExp(`## The commit and the tree, as the plugin read them\n\nbb's git plugin read the agent's environment as it handed off: the claimed commit ${HEAD} checked out, on a clean working tree\. The plugin judges the commit and the tree itself`));
  assert.match(prompt, /1\. npm test passes\n2\. npm run lint prints no errors/);
  assert.doesNotMatch(prompt, /trust me|Retries land with backoff/);
});

test("a first failed verdict goes back to the agent as its verifier's message, with each failed criterion and its evidence, and the agent works again", async () => {
  const { kit, threadId, agentThreadId, doorbells, row, verifier, handOff } = await withAgent();
  await handOff();
  assert.deepEqual([(await row()).lane, (await row()).headline], ["verifying", "Verifying: Retries land with backoff"]);
  assert.deepEqual(doorbells(), [], "no doorbell before the verdict");
  const verifierThreadId = verifier();

  assert.match(textOf(await kit.call("issue_verdict", FAILS, verifierThreadId)), /^Verdict recorded: 1 of 2 criteria passed\./);
  await settled();
  const toAgent = kit.sent().filter((args) => args.threadId === agentThreadId);
  assert.equal(toAgent.length, 1);
  assert.deepEqual([toAgent[0]?.senderThreadId, toAgent[0]?.mode], [verifierThreadId, "queue-if-active"], "marked as the verifier's message, never the user's");
  const findings = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(findings, /^## Verifier findings: 1 of 2 done-criteria not met\n\nA verifier checked your done handoff at commit `0123456`/);
  assert.match(findings, /### 1\. npm test passes\n\n\*\*Failed\.\*\* The verifier's evidence:\n\n```\n\$ npm test\nnot ok 13 - backoff caps at 6000\n  expected: 6000\n  actual: 5000\n# fail 1\n```/);
  assert.doesNotMatch(findings, /npm run lint/, "a passed criterion is not sent back");
  assert.equal(kit.thread(agentThreadId).status, "active", "the agent works again");
  assert.deepEqual([(await row()).lane, (await row()).headline], ["in-progress", "Working"]);

  await handOff();
  assert.deepEqual([(await row()).lane, (await row()).headline], ["verifying", "Verifying: Retries land with backoff"]);
  assert.notEqual(verifier(), verifierThreadId, "a new verifier checks the new handoff");
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();
  assert.deepEqual([(await row()).lane, (await row()).headline], ["in-review", "✓ Verified: Retries land with backoff"]);
  assert.deepEqual(doorbells(), [
    `[Regional Manager] 2 updates. Call crew_catch_up to read them in full.\n- i1 "Add retries" (a1) handed off: done, failed verification, findings sent back to it (fix round 1)\n- i1 "Add retries" (a1) handed off: done, verified`,
  ]);
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /findings sent back to it\n\nAt [^\n]* as its automatic fix round 1\. Nothing to do yet/);
  assert.match(catchUp, /Failed verification: 1 of 2 criteria passed[\s\S]*1\. FAIL: npm test passes\n {3}\$ npm test\n {3}not ok 13 - backoff caps at 6000/);
});

test("findings sent back wake the coordinating thread neither at once nor from the tick; the next update's doorbell and the catch-up list them", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, doorbells, verifier, handOff } = await withAgent();
  await handOff();
  await kit.call("issue_verdict", FAILS, verifier());
  await settled();
  assert.deepEqual(doorbells(), [], "no doorbell when they are sent");
  await kit.tick();
  await settled();
  assert.deepEqual(doorbells(), [], "none from the tick");
  assert.deepEqual(kit.store.unannounced(coordinatorId).map(({ event }) => event.kind), ["sent-back"], "it waits, unannounced");

  await kit.idle(agentThreadId, "Looking at it."); // the agent's fix turn ends without a handoff
  await settled();
  assert.deepEqual(doorbells(), [
    `[Regional Manager] 2 updates. Call crew_catch_up to read them in full.\n- i1 "Add retries" (a1) handed off: done, failed verification, findings sent back to it (fix round 1)\n- i1 "Add retries" (a1) ended its turn without a handoff`,
  ]);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /2 updates since your last catch-up[\s\S]*findings sent back to it[\s\S]*ended its turn without a handoff/);
});

test("a second failed verdict sends nothing to the agent, and the row waits under Needs you with ✗ for the coordinating thread", async () => {
  const { kit, threadId, agentThreadId, doorbells, row, verifier, handOff } = await withAgent();
  await handOff();
  await kit.call("issue_verdict", FAILS, verifier());
  await handOff();
  await kit.call("issue_verdict", FAILS, verifier());
  await settled();

  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 1, "only the first verdict went back");
  assert.deepEqual([(await row()).lane, (await row()).headline], ["needs-you", "✗ Failed verification after its fix round: Retries land with backoff"]);
  assert.match(doorbells().at(-1) ?? "", /- i1 "Add retries" \(a1\) handed off: done, failed verification$/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /It failed verification and is yours to decide: message the agent with agent_message, stop it with agent_stop and start a fresh agent on the issue with agent_start/);
});

test("a verdict on a superseded or stale handoff, or of a stopped agent, sends nothing to the agent and spends no round", async () => {
  const superseded = await withAgent();
  await superseded.handOff();
  const replaced = superseded.verifier();
  await superseded.kit.startTurn(superseded.agentThreadId);
  await superseded.handOff();
  assert.ok(isRefusal(await superseded.kit.call("issue_verdict", FAILS, replaced)));

  const stale = await withAgent();
  await stale.handOff();
  await stale.kit.startTurn(stale.agentThreadId); // the user types to the agent before its verdict
  await stale.kit.call("issue_verdict", FAILS, stale.verifier());

  const closed = await withAgent();
  await closed.handOff();
  await closed.kit.call("agent_stop", { agent: "a1" }, closed.threadId);
  await closed.kit.call("issue_verdict", FAILS, closed.verifier());
  await settled();

  for (const { kit, coordinatorId, agentThreadId } of [superseded, stale, closed]) {
    assert.deepEqual(kit.sent().filter((args) => args.threadId === agentThreadId), []);
    assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0);
  }
  for (const { kit, coordinatorId, check } of [stale, closed]) {
    assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()).map(({ event }) => event), [{ kind: "checked", issueId: i1, checkId: check().id }], "the regional manager decides");
  }
});

test("until bb has taken the findings, the row says Verifying and the coordinating thread hears nothing; a verdict made again meanwhile is refused", async () => {
  const { kit, coordinatorId, agentThreadId, row, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  let take = () => {};
  kit.sends.pending = new Promise((resolve) => (take = resolve));
  const returning = kit.call("issue_verdict", FAILS, verifierThreadId);
  await settled();

  assert.deepEqual([(await row()).lane, kit.store.unannounced(coordinatorId)], ["verifying", []]);
  assert.ok(isRefusal(await kit.call("issue_verdict", FAILS, verifierThreadId)), "its findings go to the agent once");
  take();
  assert.match(textOf(await returning), /^Verdict recorded/);
  assert.equal(kit.delivered(agentThreadId).length, 1, "the findings, once");
  assert.deepEqual([(await row()).lane, kit.store.agent(coordinatorId, a1)?.fixRounds], ["in-progress", 1]);
});

/** Agent threads bb refuses a message to, with its answer. */
const REFUSED: ["archivedAt" | "deletedAt", string][] = [
  ["archivedAt", "HTTP 409: Thread is archived"],
  ["deletedAt", "HTTP 404: Thread not found"],
];

for (const [gone, answer] of REFUSED) {
  test(`findings bb refuses (${answer}) leave the failed verdict with the coordinating thread, spend no round, and the catch-up says bb refused them`, async () => {
    const { kit, threadId, coordinatorId, agentThreadId, doorbells, settlement, verifier, handOff } = await withAgent();
    await handOff();
    let take = () => {};
    kit.sends.pending = new Promise((resolve) => (take = resolve));
    const returning = kit.call("issue_verdict", FAILS, verifier());
    await settled();
    kit.thread(agentThreadId)[gone] = Date.now(); // the user archives or deletes the agent's thread as the findings go
    take();
    kit.sends.pending = null;
    await returning;
    await settled();

    assert.deepEqual(kit.sent().filter((args) => args.threadId === agentThreadId), [], "bb took nothing");
    assert.deepEqual(settlement(), { kind: "checked", refused: answer, ci: { kind: "none" } });
    assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0, "the round is given back");
    assert.deepEqual(doorbells(), [`[Regional Manager] 1 update. Call crew_catch_up to read it in full.\n- i1 "Add retries" (a1) handed off: done, failed verification`]);
    const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
    assert.ok(
      catchUp.includes(`bb refused the verifier's findings when the plugin sent them to the agent as its automatic fix round, so the agent never got them and the round is not spent. bb answered: ${answer}. It failed verification and is yours to decide`),
      catchUp,
    );
  });
}

test("a done handoff that supersedes a verdict while its findings are on their way leaves them sent back and counted once", async () => {
  const { kit, coordinatorId, agentThreadId, row, check, verifier, handOff } = await withAgent();
  await handOff();
  const first = check().id;
  let take = () => {};
  kit.sends.pending = new Promise((resolve) => (take = resolve));
  const returning = kit.call("issue_verdict", FAILS, verifier());
  await settled();

  await kit.startTurn(agentThreadId); // the user asks the agent for one more change while bb takes the findings
  // It waits for i1's turn, which the findings hold until bb takes them.
  const handing = kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  assert.equal(check().id, first, "the newer handoff is stored once the findings are through");
  await kit.idle(agentThreadId, "Handed off.");
  take();
  kit.sends.pending = null;
  assert.match(textOf(await returning), /^Verdict recorded/);
  await handing;
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 1, "the findings, once");
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 1);
  assert.deepEqual(kit.store.unannounced(coordinatorId).map(({ event }) => event), [{ kind: "sent-back", issueId: i1, agentId: a1, checkId: first, round: 1 }]);

  await kit.tick();
  assert.equal(kit.store.unannounced(coordinatorId).length, 1, "the tick settles nothing again");
  await kit.call("issue_verdict", FAILS, verifier());
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 1, "nothing more goes back");
  assert.deepEqual([(await row()).lane, kit.store.agent(coordinatorId, a1)?.fixRounds], ["in-progress", 1], "the findings started the agent's next turn");
});

/** The doorbell line of a failed verdict whose findings a crash left in doubt. */
const MAYBE_SENT = `- i1 "Add retries" (a1) handed off: done, failed verification, findings may or may not have reached it`;

/** Sends that fail without proving bb refused the findings: they may or may not have reached the agent. */
const UNPROVEN: [string, Omit<SendFailure, "threadId">][] = [
  ["bb took them, then the call timed out", { error: Object.assign(new Error("BB request timed out after 75 seconds."), { name: "BbRequestTimeoutError" }), taken: true }],
  ["the connection dropped", { error: new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }), taken: true }],
  ["an error with no status", { error: new Error("socket hang up"), taken: false }],
  ["bb failed after taking them", { error: bbHttpError(500, "internal_error", "Internal Server Error"), taken: true }],
];

for (const [how, failure] of UNPROVEN) {
  test(`a send that fails without bb refusing the findings (${how}) keeps the round spent, wakes the coordinating thread, and is never sent again`, async () => {
    const { kit, threadId, coordinatorId, agentThreadId, doorbells, settlement, verifier, handOff } = await withAgent();
    await handOff();
    kit.sends.failure = { threadId: agentThreadId, ...failure };
    await kit.call("issue_verdict", FAILS, verifier());
    await settled();
    kit.sends.failure = null;

    assert.equal(kit.delivered(agentThreadId).length, failure.taken ? 1 : 0, failure.taken ? "bb took the findings" : "bb never had them");
    assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
    assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 1, "the round stays spent");
    assert.deepEqual(doorbells(), [`[Regional Manager] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`], "the regional manager is woken");
    assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /nothing bb keeps shows whether they arrived: they may or may not have\. Read the issue with issue_read before you message the agent/);

    await kit.tick();
    await settled();
    assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, failure.taken ? 1 : 0, "not sent again");
    assert.deepEqual(kit.store.unannounced(coordinatorId), [], "settled once");
  });
}

test("a crash before the findings leave, then an unrelated turn in the agent's thread: the tick hands the verdict to the coordinating thread, never as sent back", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, doorbells, latest, settlement, verifier, handOff } = await withAgent();
  await handOff();
  kit.sends.pending = new Promise(() => {}); // the plugin dies before bb has the findings
  void kit.call("issue_verdict", FAILS, verifier());
  await settled();
  assert.deepEqual([kit.sent().filter((args) => args.threadId === agentThreadId).length, kit.store.agent(coordinatorId, a1)?.fixRounds], [0, 1], "the round is claimed before they leave");

  kit.sends.pending = null;
  kit.reload();
  await kit.startTurn(agentThreadId); // the user asks the agent something before the tick
  await kit.tick();
  await settled();
  assert.deepEqual(kit.sent().filter((args) => args.threadId === agentThreadId), [], "nothing is sent on a guess");
  assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 1, "the claim is kept");
  assert.deepEqual(doorbells(), [`[Regional Manager] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`], "the regional manager is woken");
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /nothing bb keeps shows whether they arrived: they may or may not have\. Read the issue with issue_read before you message the agent/);
  assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()), [], "told once");
  await kit.tick();
  await settled();
  assert.deepEqual([kit.sent().filter((args) => args.threadId === agentThreadId).length, kit.store.unannounced(coordinatorId)], [0, []], "settled once");
  assert.equal(latest().handoff.status, "done");
});

test("findings bb queued before a crash are not sent again by the next tick", async () => {
  const { kit, coordinatorId, agentThreadId, doorbells, settlement, verifier } = await withAgent();
  await kit.call("agent_handoff", DONE, agentThreadId); // its turn is still running, so bb queues the findings
  await settled();
  kit.sends.unanswered = true;
  void kit.call("issue_verdict", FAILS, verifier());
  await settled();
  assert.deepEqual([kit.queued(agentThreadId).length, kit.delivered(agentThreadId).length, kit.store.unannounced(coordinatorId)], [1, 0, []], "bb holds them; nobody is told yet");

  kit.sends.unanswered = false;
  kit.reload();
  await kit.tick();
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 1, "not sent twice");
  assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.deepEqual(doorbells(), [`[Regional Manager] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`]);

  await kit.dispatch(kit.queued(agentThreadId)[0] ?? assert.fail("nothing queued"));
  await kit.tick();
  await settled();
  assert.deepEqual([kit.delivered(agentThreadId).length, kit.sent().filter((args) => args.threadId === agentThreadId).length], [1, 1], "the agent gets them once");
});

test("findings bb delivered before a crash are not sent again by the next tick", async () => {
  const { kit, coordinatorId, agentThreadId, doorbells, settlement, verifier, handOff } = await withAgent();
  await handOff();
  kit.sends.unanswered = true;
  void kit.call("issue_verdict", FAILS, verifier());
  await settled();
  assert.equal(kit.delivered(agentThreadId).length, 1, "bb took the findings");

  kit.sends.unanswered = false;
  kit.reload();
  await kit.tick();
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 1, "not sent twice");
  assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 1);
  assert.deepEqual(doorbells(), [`[Regional Manager] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`]);
});

test("a failed verdict returned after its agent's thread was deleted, before the plugin heard, goes to the regional manager at once, sending nothing", async () => {
  const { kit, coordinatorId, agentThreadId, settlement, verifier, handOff } = await withAgent();
  await handOff();
  kit.thread(agentThreadId).deletedAt = Date.now();
  const attempts = kit.sendAttempts().length;
  await kit.call("issue_verdict", FAILS, verifier());
  await settled();

  assert.deepEqual(settlement(), { kind: "checked", refused: null, ci: { kind: "none" } });
  assert.ok(!kit.sendAttempts().slice(attempts).includes(agentThreadId), "no findings sent to the deleted thread");
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0);
  assert.deepEqual(kit.warnings(), []);
});

test("an agent turn that starts after the verifier's model is looked up, before the decision, keeps the findings from going back", async () => {
  const { kit, coordinatorId, agentThreadId, check, verifier, handOff } = await withAgent();
  await handOff();
  let answers = 0;
  // why the first: issue_verdict looks up only the verifier's model; the agent's is the one stored as it handed off.
  kit.modelLookups.answered = () => {
    if (++answers === 1) void kit.startTurn(agentThreadId);
  };
  await kit.call("issue_verdict", FAILS, verifier());
  await settled();

  assert.equal(answers, 1);
  assert.deepEqual(kit.sent().filter((args) => args.threadId === agentThreadId), []);
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0);
  assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()).map(({ event }) => event), [{ kind: "checked", issueId: i1, checkId: check().id }]);
});

test("a verdict that passes every criterion is In review with ✓ and the models bb ran the verifier on", async () => {
  const { kit, doorbells, row, verdict, verifier, handOff } = await withAgent();
  await handOff();
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();

  const passed = await row();
  assert.deepEqual([passed.lane, passed.headline], ["in-review", "✓ Verified: Retries land with backoff"]);
  const returned = verdict();
  assert.ok(returned.state === "returned");
  assert.deepEqual([returned.model, returned.sameModel], [{ providerId: "codex", model: "gpt-default" }, false]);
  assert.deepEqual(
    returned.criteria.map((check) => [check.criterion, check.result]),
    CRITERIA.map((criterion) => [criterion, "pass"]),
  );
  assert.match(doorbells()[0] ?? "", /handed off: done, verified$/);
});

test("an issue opened on the board reads what it is about, its criteria and each handoff with its verdict, names no model and no brief, and an issue it hasn't is refused", async () => {
  const { kit, coordinatorId, agentThreadId, opened, verifier, handOff } = await withAgent();
  await handOff();
  await kit.call("issue_verdict", FAILS, verifier());
  await settled();
  await handOff();
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();

  const detail = await opened();
  assert.deepEqual([detail.description, detail.doneCriteria], ["Failed webhook deliveries are lost.", CRITERIA]);
  assert.deepEqual(
    detail.record.map(({ agent, handoffs }) => [agent, handoffs.map(({ status, summary, verdict }) => [status, summary, verdict?.state === "returned" && verdict.criteria.map((check) => check.result)])]),
    [
      [
        { id: "a1", threadId: agentThreadId, ended: null },
        [
          ["done", "Retries land with backoff", ["fail", "pass"]],
          ["done", "Retries land with backoff", ["pass", "pass"]],
        ],
      ],
    ],
  );
  const sent = JSON.stringify(detail);
  for (const unshown of ["gpt-default", "codex", "Retry failed deliveries with backoff."]) assert.ok(!sent.includes(unshown), `the detail carries no ${unshown}`);

  await assert.rejects(async () => kit.rpc.issue({ coordinatorId, issueId: issueIdSchema.parse("i9") }), { code: "not_found", message: "This regional manager has no issue i9." });
});

test("an issue opened on the board sends of each verdict only what the board shows: no checkout before it returns, no nudge, no fix round, no CI while its findings go back", async () => {
  const { kit, coordinatorId, agentThreadId, opened, verifier } = await withAgent();
  const shown = async () => (await opened()).record[0]?.handoffs.at(-1)?.verdict ?? assert.fail("no verdict");
  // As if the plugin reloaded between storing the handoff and starting its verifier: it waits, queued.
  const turnSeq = kit.thread(agentThreadId).turns.at(-1) ?? assert.fail("no turn");
  const { headSha, ...report } = DONE;
  const handoff = { id: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), coordinatorId, issueId: i1, agentId: a1, at: Date.now(), turnSeq, ...report, status: "done" as const };
  kit.inbox.handoff({ ...handoff, delivery: { kind: "commit", headSha, prUrl: null } }, { kind: "read", branch: null, checkout: { headSha: HEAD, changedFiles: [], changedFileCount: 0 } });
  assert.deepEqual(await shown(), { state: "queued" });

  await kit.tick();
  assert.deepEqual(await shown(), { state: "running", verifierThreadId: verifier() });

  // Its findings on their way back to the agent: bb holds the send.
  let take = () => {};
  kit.sends.pending = new Promise((resolve) => (take = resolve));
  const returning = kit.call("issue_verdict", FAILS, verifier());
  await settled();
  const sendingBack = await shown();
  assert.deepEqual(Object.keys(sendingBack).sort(), ["checkout", "criteria", "findings", "headSha", "sameModel", "settlement", "state", "verifierThreadId"]);
  assert.deepEqual(sendingBack.state === "returned" && sendingBack.settlement, { kind: "sending-back" });

  take();
  await returning;
  await settled();
  const returned = await shown();
  assert.deepEqual(Object.keys(returned).sort(), ["checkout", "criteria", "findings", "headSha", "sameModel", "settlement", "state", "verifierThreadId"]);
  assert.deepEqual(returned.state === "returned" && returned.settlement, { kind: "sent-back", ci: { kind: "none" } });
});

// QA-03: a Claude Code verifier's per-command sandbox showed a boat sandbox's home dotfiles as
// untracked, and its own "the tree is clean" check failed clean work and spent the fix round.
test("an agent bb reads at the claimed commit on a clean tree is judged on its criteria alone, and its verifier is never asked to check the commit or the tree", async () => {
  const { kit, coordinatorId, agentThreadId, row, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "skills", "verifying", "SKILL.md"), "utf8");
  const asked = [kit.thread(verifierThreadId).spawnedWith.prompt, kit.configurationFor(verifierThreadId, {}).instructions, skill].join("\n");
  assert.doesNotMatch(asked, /git status|rev-parse|porcelain/, "nothing tells the verifier to run git to check the commit or the tree");
  const parameters = kit.tools().find((tool) => tool.name === "issue_verdict")?.parameters ?? assert.fail("no issue_verdict");
  assert.equal(JSON.stringify(z.toJSONSchema(parameters)).includes("headSha"), false, "issue_verdict asks for no commit");

  await kit.call("issue_verdict", PASSES, verifierThreadId);
  await settled();
  assert.deepEqual([(await row()).lane, (await row()).headline], ["in-review", "✓ Verified: Retries land with backoff"]);
  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 0, "nothing went back to the agent");
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0);
});

test("a tree bb reads with changes fails the verdict with bb's evidence, whatever the criteria say, and goes back to the agent as its fix round", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, row, verifier, handOff } = await withAgent();
  kit.git.changedFiles.set(kit.thread(agentThreadId).environmentId ?? assert.fail("no environment"), 2);
  await handOff();
  const prompt = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, /the working tree had 2 changed files: \?\? scratch-1\.txt, \?\? scratch-2\.txt\. The plugin judges[^\n]*This already fails the verdict, whatever you find; check every criterion anyway/);

  await kit.call("issue_verdict", PASSES, verifier());
  await settled();
  const findings = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(findings, /^## Verifier findings: every done-criterion passed, and the claimed commit wasn't checked out on a clean tree\n/);
  assert.match(findings, /### The commit and the tree\n\nbb's git plugin read the agent's environment as it handed off: the working tree had 2 changed files: \?\? scratch-1\.txt, \?\? scratch-2\.txt\. Commit what belongs/);
  assert.deepEqual([(await row()).lane, (await row()).headline], ["in-progress", "Working"], "the agent works again, on its one fix round");
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 1);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /Failed verification: not the claimed commit on a clean tree\. 2 of 2 criteria passed[^\n]*bb's git plugin read the agent's environment as it handed off: the working tree had 2 changed files/);

  // The fix round works as before: the agent cleans up and hands off again, and a clean pass is verified.
  kit.git.changedFiles.clear();
  await handOff();
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();
  assert.deepEqual([(await row()).lane, (await row()).headline], ["in-review", "✓ Verified: Retries land with backoff"]);
});

test("a commit bb reads other than the claimed one fails the verdict with bb's evidence; failing again after the fix round goes to the coordinating thread", async () => {
  const { kit, agentThreadId, row, opened, verifier, handOff } = await withAgent();
  kit.git.heads.set(kit.thread(agentThreadId).environmentId ?? assert.fail("no environment"), "f".repeat(40));
  await handOff();
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();
  assert.match(kit.delivered(agentThreadId).at(-1) ?? "", new RegExp(`HEAD was f{40}, not the claimed ${HEAD}\\.`));

  await handOff();
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 1, "only the first verdict went back");
  assert.deepEqual([(await row()).lane, (await row()).headline], ["needs-you", "✗ Not the claimed commit on a clean tree after its fix round: Retries land with backoff"]);
  const shown = (await opened()).record[0]?.handoffs.at(-1)?.verdict;
  assert.ok(shown?.state === "returned");
  assert.deepEqual(shown.checkout, { headSha: "f".repeat(40), changedFiles: [], changedFileCount: 0 }, "the board has bb's read to show");
});

test("a checkout bb's git plugin can't read is Couldn't verify at once: no verifier, nothing sent to the agent, no fix round spent", async () => {
  const cases: [string, (kit: Awaited<ReturnType<typeof withAgent>>["kit"], environmentId: string) => void, RegExp][] = [
    ["its machine offline", (kit, id) => kit.git.offline.add(id), /\(The environment's machine is offline\)/],
    ["not a git repository", (kit, id) => kit.git.nonGit.add(id), /\(the environment is not a git repository\)/],
    ["an answer the plugin can't read", (kit, id) => kit.git.newer.set(id, { outcome: "rebasing" }), /\(bb's git plugin answered "rebasing" in a shape this plugin can't read\)/],
    ["no commit named", (kit, id) => kit.git.newer.set(id, { outcome: "available", workspace: { checkout: { kind: "unborn", branchName: "main" }, workingTree: { fileCount: 0, files: [] } } }), /\(it named no commit checked out\)/],
  ];
  for (const [name, unreadable, reason] of cases) {
    const { kit, threadId, coordinatorId, agentThreadId, doorbells, row, verdict, handOff } = await withAgent();
    unreadable(kit, kit.thread(agentThreadId).environmentId ?? assert.fail("no environment"));
    const spawned = kit.spawned();
    assert.match(await handOff(), /marked couldn't verify: bb's git plugin couldn't read the agent's commit and working tree/, name);

    const current = verdict();
    assert.ok(current.state === "could-not-run", name);
    assert.match(current.reason, reason, name);
    assert.equal(kit.spawned(), spawned, `${name}: no verifier`);
    await kit.tick();
    await settled();
    assert.equal(kit.sent().filter((args) => args.threadId === agentThreadId).length, 0, `${name}: nothing went back to the agent`);
    assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0, `${name}: no fix round spent`);
    assert.deepEqual([(await row()).lane, (await row()).headline], ["needs-you", "Couldn't verify: Retries land with backoff"], name);
    assert.match(doorbells().at(-1) ?? "", /handed off: done, could not be verified$/, name);
    assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /Couldn't verify: bb's git plugin couldn't read the agent's commit and working tree as it handed off/, name);
  }
});

test("issue_verdict refuses a caller that is not this handoff's verifier, and a skipped, repeated or unknown criterion", async () => {
  const { kit, threadId, agentThreadId, verdict, verifier, handOff } = await withAgent();
  await handOff();
  const [first, second] = PASSES.criteria;
  const refusals: [string, unknown, RegExp][] = [
    [threadId, PASSES, /only a verifier thread/],
    [agentThreadId, PASSES, /only a verifier thread/],
    [verifier(), { ...PASSES, criteria: [first] }, /missing 2 of 1 to 2/],
    [verifier(), { ...PASSES, criteria: [first, first, second] }, /1 appears more than once/],
    [verifier(), { ...PASSES, criteria: [first, second, { ...second, criterion: 3 }] }, /only 2 done-criteria; 3 is not one/],
  ];
  for (const [caller, input, reason] of refusals) {
    const result = await kit.call("issue_verdict", input, caller);
    assert.ok(isRefusal(result), String(reason));
    assert.match(textOf(result), reason);
  }
  assert.equal(verdict().state, "running");
});

test("a second verdict from the same verifier is refused, and the first stands", async () => {
  const { kit, verdict, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  await kit.call("issue_verdict", FAILS, verifierThreadId);
  const result = await kit.call("issue_verdict", PASSES, verifierThreadId);
  assert.ok(isRefusal(result));
  assert.match(textOf(result), /no longer waits for your verdict/);
  const stands = verdict();
  assert.deepEqual(stands.state === "returned" && stands.criteria.map((check) => check.result), ["fail", "pass"]);
});

test("with the switch off a done handoff starts no verifier and reads Unverified; switching it back on leaves that row alone", async () => {
  const { kit, coordinatorId, doorbells, row, verdict, handOff } = await withAgent({ verify: false });
  const spawned = kit.spawned();
  assert.match(await handOff(), /marked unverified: verification is off/);
  assert.equal(kit.spawned(), spawned, "no verifier");
  assert.deepEqual(verdict(), { state: "waived" });
  assert.deepEqual([(await row()).lane, (await row()).headline], ["in-review", "Unverified: Retries land with backoff"]);
  assert.match(doorbells()[0] ?? "", /handed off: done, unverified$/);

  await kit.rpc.setVerify({ coordinatorId, verify: true });
  await kit.tick();
  await settled();
  assert.equal(kit.spawned(), spawned, "turning it on checks no earlier handoff");
  assert.deepEqual([(await row()).lane, (await row()).headline, verdict()], ["in-review", "Unverified: Retries land with backoff", { state: "waived" }]);
  assert.match(doorbells().at(-1) ?? "", /The user turned verification of done handoffs on$/);
  assert.deepEqual((await kit.rpc.board({ coordinatorId })).verify, true);
});

test("the switch applies to handoffs made after it, and setting it to what it is records nothing", async () => {
  const { kit, coordinatorId, agentThreadId, verdict, handOff } = await withAgent();
  await kit.rpc.setVerify({ coordinatorId, verify: true });
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);

  await kit.rpc.setVerify({ coordinatorId, verify: false });
  assert.equal((await kit.rpc.board({ coordinatorId })).verify, false);
  await handOff();
  assert.deepEqual(verdict(), { state: "waived" });

  await kit.rpc.setVerify({ coordinatorId, verify: true });
  await kit.startTurn(agentThreadId);
  await handOff();
  assert.equal(verdict().state, "running");
});

test("a verdict whose verifier never started is started by the next tick", async () => {
  const { kit, coordinatorId, agentThreadId, verdict } = await withAgent();
  // As if the plugin reloaded between storing the handoff and starting its verifier.
  const id = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e");
  const turnSeq = kit.thread(agentThreadId).turns.at(-1) ?? assert.fail("no turn");
  const checkout = { headSha: HEAD, changedFiles: [], changedFileCount: 0 };
  const { headSha, ...report } = DONE;
  kit.inbox.handoff({ id, coordinatorId, issueId: i1, agentId: a1, at: Date.now(), turnSeq, ...report, status: "done", delivery: { kind: "commit", headSha, prUrl: null } }, { kind: "read", branch: null, checkout });
  const spawned = kit.spawned();
  assert.deepEqual(verdict(), { state: "queued", checkout });

  await kit.tick();
  assert.equal(kit.spawned(), spawned + 1);
  const started = verdict();
  assert.equal(started.state, "running");
  assert.equal(kit.thread(started.state === "running" ? started.verifierThreadId : "").spawnedWith.parentThreadId, agentThreadId);
  await kit.tick();
  assert.equal(kit.spawned(), spawned + 1, "a running verifier is not started again");
});

test("a verifier that goes idle without a verdict is nudged once, then the row reads Couldn't verify under Needs you", async () => {
  const { kit, doorbells, row, verdict, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  await kit.tick();
  assert.deepEqual(kit.delivered(verifierThreadId), [], "a verifier still working is left alone");

  await kit.idle(verifierThreadId, "All good.");
  await kit.tick();
  assert.match(kit.delivered(verifierThreadId).join(), /without calling issue_verdict/);
  assert.equal(verdict().state, "running");
  await kit.tick();
  assert.equal(kit.delivered(verifierThreadId).length, 1, "nudged once, while it works on the nudge");

  await kit.idle(verifierThreadId, "Still all good.");
  await kit.tick();
  await settled();
  assert.deepEqual(verdict(), { state: "could-not-run", verifierThreadId, reason: "its verifier stopped without a verdict twice, the second time after a reminder" });
  assert.deepEqual([(await row()).lane, (await row()).headline], ["needs-you", "Couldn't verify: Retries land with backoff"]);
  assert.match(doorbells()[0] ?? "", /handed off: done, could not be verified$/);
  assert.ok(isRefusal(await kit.call("issue_verdict", PASSES, verifierThreadId)), "a verdict after giving up is refused");
});

test("a verifier whose sandbox was removed before its verdict reads Couldn't verify at the next tick, with no reminder sent", async () => {
  const { kit, doorbells, row, verdict, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  // As bb leaves it when the machine is removed: the environment destroyed, the verifier's start failed.
  kit.environments.destroyed.add(kit.environment(verifierThreadId));
  kit.thread(verifierThreadId).status = "error";
  await kit.tick();
  await settled();
  assert.deepEqual(verdict(), {
    state: "could-not-run",
    verifierThreadId,
    reason: "its environment was removed (a sandbox removed or reaped) before its verifier returned a verdict",
  });
  assert.deepEqual(kit.delivered(verifierThreadId), [], "no reminder to a thread that can't run");
  assert.deepEqual([(await row()).lane, (await row()).headline], ["needs-you", "Couldn't verify: Retries land with backoff"]);
  assert.match(doorbells()[0] ?? "", /handed off: done, could not be verified$/);
});

test("a reload while the tick reads a quiet verifier's environment leaves its one reminder to the new instance", async () => {
  const { kit, verdict, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  await kit.idle(verifierThreadId, "All three pass.");
  kit.environments.holding = true;
  void kit.tick();
  await settled();
  assert.equal(kit.environments.held.length, 1, "the old instance is reading the environment");

  kit.reload();
  kit.environments.holding = false;
  kit.environments.held.splice(0).forEach((release) => release());
  await settled();
  const checkout = { headSha: HEAD, changedFiles: [], changedFileCount: 0 };
  assert.deepEqual([verdict(), kit.delivered(verifierThreadId)], [{ state: "running", verifierThreadId, nudged: false, checkout }, []], "the old instance neither marks nor sends it");

  await kit.tick();
  await settled();
  assert.deepEqual([verdict(), kit.delivered(verifierThreadId).length], [{ state: "running", verifierThreadId, nudged: true, checkout }, 1], "the new instance reminds it once");
});

test("a verifier whose thread is archived is given up on at the next tick", async () => {
  const { kit, verdict, verifier, handOff } = await withAgent();
  await handOff();
  const verifierThreadId = verifier();
  kit.thread(verifierThreadId).archivedAt = Date.now();
  await kit.tick();
  assert.deepEqual(verdict(), { state: "could-not-run", verifierThreadId, reason: "its verifier thread was archived or deleted before it returned a verdict" });
});

test("a second done handoff supersedes the first verdict and stops its verifier, whose verdict is then refused", async () => {
  const { kit, coordinatorId, agentThreadId, doorbells, latest, check, verifier, handOff } = await withAgent();
  await handOff();
  const first = latest();
  const firstVerifier = verifier();

  await kit.startTurn(agentThreadId); // the user asks the agent for one more change
  await handOff();
  assert.deepEqual(kit.store.handoff(first.handoff.id)?.check?.verdict, { state: "superseded" });
  assert.equal(kit.thread(firstVerifier).status, "idle", "stopped");
  assert.notEqual(verifier(), firstVerifier);

  assert.ok(isRefusal(await kit.call("issue_verdict", PASSES, firstVerifier)));
  await kit.call("issue_verdict", PASSES, verifier());
  await settled();
  assert.equal(doorbells().length, 1, "only the newer handoff is announced");
  assert.deepEqual(
    kit.store.takeUnread(coordinatorId, Date.now()).map(({ event }) => event.kind === "checked" && event.checkId),
    [check().id],
  );
});

test("a verifier bb won't start leaves the row Couldn't verify, with bb's reason; one whose answer alone was lost runs", async () => {
  const lost = await withAgent();
  lost.kit.spawns.created = false;
  lost.kit.spawns.answer = "lost";
  await lost.handOff();
  assert.deepEqual(lost.verdict(), { state: "could-not-run", verifierThreadId: null, reason: "bb did not start a verifier: socket hang up" });
  assert.equal((await lost.row()).headline, "Couldn't verify: Retries land with backoff");
  assert.match(lost.doorbells()[0] ?? "", /could not be verified$/);

  const bound = await withAgent();
  bound.kit.spawns.answer = "lost";
  await bound.handOff();
  assert.equal(bound.verdict().state, "running", "bound through thread.created");
});

test("the verifier runs on the regional manager's model when the agent's differs", async () => {
  const { kit, threadId, verifier, handOff } = await withAgent();
  const coordinator = kit.thread(threadId).execution ?? assert.fail("no execution");
  coordinator.model = "sonnet"; // the regional manager's latest turn ran on another model than its agent's
  await handOff();
  assert.deepEqual([kit.thread(verifier()).providerId, kit.thread(verifier()).execution?.model], ["claude-code", "sonnet"]);
});

test("with no other provider the verifier runs on another model of the agent's, then on the agent's own, which its verdict says", async () => {
  const sibling = await withAgent();
  sibling.kit.providers.list = sibling.kit.providers.list.filter((provider) => provider.id === "claude-code");
  await sibling.handOff();
  assert.deepEqual([sibling.kit.thread(sibling.verifier()).providerId, sibling.kit.thread(sibling.verifier()).execution?.model], ["claude-code", "sonnet"]);

  const alone = await withAgent();
  alone.kit.providers.list = [
    { id: "claude-code", available: true, models: [{ model: "opus", isDefault: true, defaultReasoningEffort: "high" }] },
    { id: "codex", available: true, models: null },
    { id: "pi", available: false, models: [{ model: "pi-1", isDefault: true, defaultReasoningEffort: "low" }] },
  ];
  await alone.handOff();
  assert.deepEqual([alone.kit.thread(alone.verifier()).providerId, alone.kit.thread(alone.verifier()).execution?.model], ["claude-code", "opus"]);
  await alone.kit.call("issue_verdict", PASSES, alone.verifier());
  const verdict = alone.verdict();
  assert.ok(verdict.state === "returned");
  assert.equal(verdict.sameModel, true);
});

test("no registered tool can change whether a regional manager verifies, whoever calls it with whatever input", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, verifier, handOff } = await withAgent();
  await handOff();
  const callers = [threadId, agentThreadId, verifier()];
  const inputs = [{}, { verify: false }, { coordinatorId, verify: false }, { id: "i1", verify: false, enabled: false, verifier: null }];
  for (const { name, parameters } of kit.tools()) {
    // why keys only: a value such as the result "unverifiable" is no way in. why not `verifier`: it
    // names what checks an issue (a provider and a model, or null for the plugin's pick), never whether.
    assert.doesNotMatch(JSON.stringify(z.toJSONSchema(parameters, { io: "input" })), /"(?!verifier")[^"]*verif[^"]*":/i, `${name} takes no field about verification`);
    for (const caller of callers) for (const input of inputs) await kit.call(name, input, caller).catch(() => undefined);
  }
  assert.equal(kit.store.verifies(coordinatorId), true);
  assert.ok(!kit.store.takeUnread(coordinatorId, Date.now()).some(({ event }) => event.kind === "verification-toggled"));
});

test("a done handoff's verifier runs on the verifier named on its issue, and the verdict says so", async () => {
  const { kit, threadId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId, { doneCriteria: CRITERIA, verifier: { providerId: "claude-code", model: "sonnet" } });
  await kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  const running = kit.store.openChecks()[0]?.verdict;
  const verifier = kit.thread(running?.state === "running" ? running.verifierThreadId : assert.fail("no verifier running"));
  assert.deepEqual([verifier.providerId, verifier.execution?.model, verifier.execution?.reasoningLevel], ["claude-code", "sonnet", "medium"]);

  await kit.call("issue_verdict", PASSES, verifier.id);
  await settled();
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /checked at 0123456789abcdef0123456789abcdef01234567 by a verifier on claude-code sonnet, as named on i1\./);
});

test("a verifier named that bb can't run in the agent's environment is passed over for today's choice, and the verdict says why", async () => {
  const { kit, threadId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId, { doneCriteria: CRITERIA, verifier: { providerId: "codex", model: "gpt-default" } });
  // bb lists codex there, but can't load its models in the agent's environment.
  kit.providers.list = kit.providers.list.map((provider) => (provider.id === "codex" ? { ...provider, models: null } : provider));
  await kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  const running = kit.store.openChecks()[0]?.verdict;
  const verifier = kit.thread(running?.state === "running" ? running.verifierThreadId : assert.fail("no verifier running"));
  assert.deepEqual([verifier.providerId, verifier.execution?.model], ["claude-code", "sonnet"], "another model of the agent's provider, as today");

  await kit.call("issue_verdict", PASSES, verifier.id);
  await settled();
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /by a verifier on claude-code sonnet, not the codex gpt-default named on i1: bb can't run it in a1's environment\./);
});

test("a verifier named while a check runs leaves that check as it is, and applies to the next handoff", async () => {
  const { kit, threadId, coordinatorId, check, verifier, handOff } = await withAgent();
  await handOff();
  const running = verifier();
  assert.equal(
    textOf(await kit.call("issue_update", { id: "i1", verifier: { providerId: "claude-code", model: "sonnet" } }, threadId)),
    "Updated i1. i1's done handoffs, and its final check as a parent, are checked on claude-code sonnet (medium) from the next one on; a check already running keeps its own.",
  );
  assert.equal(check().verifier, null);
  assert.equal(verifier(), running);
  assert.deepEqual(kit.store.issue(coordinatorId, i1)?.verifier, { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium" });
});
