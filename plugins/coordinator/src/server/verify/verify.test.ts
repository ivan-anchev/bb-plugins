import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema } from "../../model/handoff.ts";
import { crewIdSchema } from "../../model/role.ts";
import type { Verdict } from "../../model/verdict/verdict.ts";
import { bbHttpError, coordinating, isRefusal, settled, textOf, threadIn, type SendFailure } from "../test-harness.ts";

const c1 = crewIdSchema.parse("c1");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
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
  headSha: HEAD,
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

/** A Coordinator with one crew, both idle, so a doorbell starts the Coordinator's turn. */
async function withCrew({ verify = true } = {}) {
  const { kit, threadId, coordinatorId } = await coordinating({ verify });
  const crewThreadId = threadIn(textOf(await kit.call("crew_start", { title: "Add retries", brief: "Retry failed deliveries with backoff.", doneCriteria: CRITERIA }, threadId)));
  kit.thread(threadId).status = "idle";
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  const row = async () => (await kit.rpc.board({ coordinatorId })).rows[0] ?? assert.fail("no row");
  const latest = () => kit.store.latestHandoff(coordinatorId, c1) ?? assert.fail("no handoff");
  const verdict = (): Verdict => {
    const handoff = latest();
    return handoff.status === "done" ? handoff.verdict : assert.fail(`the handoff is ${handoff.status}`);
  };
  const verifier = (): string => {
    const current = verdict();
    return current.state === "running" ? current.verifierThreadId : assert.fail(`the verdict is ${current.state}`);
  };
  const settlement = () => {
    const current = verdict();
    return current.state === "returned" ? current.settlement : assert.fail(`the verdict is ${current.state}`);
  };
  /** The crew hands off as done and ends its turn. */
  async function handOff(): Promise<string> {
    const answer = textOf(await kit.call("crew_handoff", DONE, crewThreadId));
    await kit.idle(crewThreadId, "Handed off.");
    await settled();
    return answer;
  }
  return { kit, threadId, coordinatorId, crewThreadId, doorbells, row, latest, verdict, verifier, settlement, handOff };
}

test("a done handoff starts a hidden verifier as the crew's child, in its environment, on another provider, with no inherited choices", async () => {
  const { kit, threadId, crewThreadId, verifier, handOff } = await withCrew();
  assert.match(await handOff(), /A verifier now checks your commit/);
  const { spawnedWith, providerId, execution } = kit.thread(verifier());

  assert.equal(spawnedWith.visibility, "hidden");
  assert.equal(spawnedWith.parentThreadId, crewThreadId);
  assert.equal(spawnedWith.lifecycleOwnerThreadId, threadId);
  assert.equal(spawnedWith.parentNotifications, "off");
  assert.deepEqual(spawnedWith.environment, { type: "reuse", environmentId: kit.thread(crewThreadId).environmentId });
  assert.equal("executionInputSources" in spawnedWith, false);
  // why bb's record, not the request: bb drops what it doesn't count, and the crew runs on claude-code / opus.
  assert.deepEqual([providerId, execution?.model, execution?.permissionMode], ["codex", "gpt-default", "auto"]);
  assert.equal(kit.configurationFor(verifier(), {}).tools?.join(), "crew_memory_read,crew_verdict");
  assert.ok(kit.configurationFor(verifier(), {}).skills?.includes("verifying"));
});

test("a verifier's brief holds the claimed commit and every criterion numbered, and none of the crew's own report", async () => {
  const { kit, verifier, handOff } = await withCrew();
  await handOff();
  const prompt = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, new RegExp(`git rev-parse HEAD[\\s\\S]*If HEAD is not ${HEAD}`));
  assert.match(prompt, /1\. npm test passes\n2\. npm run lint prints no errors/);
  assert.doesNotMatch(prompt, /trust me|Retries land with backoff/);
});

test("a first failed verdict goes back to the crew as its verifier's message, with each failed criterion and its evidence, and the crew works again", async () => {
  const { kit, threadId, crewThreadId, doorbells, row, verifier, handOff } = await withCrew();
  await handOff();
  assert.deepEqual([(await row()).state, (await row()).headline], ["verifying", "Verifying: Retries land with backoff"]);
  assert.deepEqual(doorbells(), [], "no doorbell before the verdict");
  const verifierThreadId = verifier();

  assert.match(textOf(await kit.call("crew_verdict", FAILS, verifierThreadId)), /^Verdict recorded: 1 of 2 criteria passed\./);
  await settled();
  const toCrew = kit.sent().filter((args) => args.threadId === crewThreadId);
  assert.equal(toCrew.length, 1);
  assert.deepEqual([toCrew[0]?.senderThreadId, toCrew[0]?.mode], [verifierThreadId, "queue-if-active"], "marked as the verifier's message, never the user's");
  const findings = kit.delivered(crewThreadId).at(-1) ?? assert.fail("nothing reached the crew");
  assert.match(findings, /^## Verifier findings: 1 of 2 done-criteria not met\n\nA verifier checked your done handoff at commit `0123456`/);
  assert.match(findings, /### 1\. npm test passes\n\n\*\*Failed\.\*\* The verifier's evidence:\n\n```\n\$ npm test\nnot ok 13 - backoff caps at 6000\n  expected: 6000\n  actual: 5000\n# fail 1\n```/);
  assert.doesNotMatch(findings, /npm run lint/, "a passed criterion is not sent back");
  assert.equal(kit.thread(crewThreadId).status, "active", "the crew works again");
  assert.deepEqual([(await row()).state, (await row()).headline], ["working", "Working"]);

  await handOff();
  assert.deepEqual([(await row()).state, (await row()).headline], ["verifying", "Verifying: Retries land with backoff"]);
  assert.notEqual(verifier(), verifierThreadId, "a new verifier checks the new handoff");
  await kit.call("crew_verdict", PASSES, verifier());
  await settled();
  assert.deepEqual([(await row()).state, (await row()).headline], ["ready-for-review", "✓ Verified: Retries land with backoff"]);
  assert.deepEqual(doorbells(), [
    `[Coordinator] 2 updates. Call crew_catch_up to read them in full.\n- c1 "Add retries" handed off: done, failed verification, findings sent back to it (fix round 1)\n- c1 "Add retries" handed off: done, verified`,
  ]);
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /findings sent back to it\n\nAt [^\n]* as its automatic fix round 1\. Nothing to do yet/);
  assert.match(catchUp, /Failed verification: 1 of 2 criteria passed[\s\S]*1\. FAIL: npm test passes\n {3}\$ npm test\n {3}not ok 13 - backoff caps at 6000/);
});

test("findings sent back wake the coordinating thread neither at once nor from the tick; the next update's doorbell and the catch-up list them", async () => {
  const { kit, threadId, coordinatorId, crewThreadId, doorbells, verifier, handOff } = await withCrew();
  await handOff();
  await kit.call("crew_verdict", FAILS, verifier());
  await settled();
  assert.deepEqual(doorbells(), [], "no doorbell when they are sent");
  await kit.tick();
  await settled();
  assert.deepEqual(doorbells(), [], "none from the tick");
  assert.deepEqual(kit.store.unannounced(coordinatorId).map(({ event }) => event.kind), ["sent-back"], "it waits, unannounced");

  await kit.idle(crewThreadId, "Looking at it."); // the crew's fix turn ends without a handoff
  await settled();
  assert.deepEqual(doorbells(), [
    `[Coordinator] 2 updates. Call crew_catch_up to read them in full.\n- c1 "Add retries" handed off: done, failed verification, findings sent back to it (fix round 1)\n- c1 "Add retries" ended its turn without a handoff`,
  ]);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /2 updates since your last catch-up[\s\S]*findings sent back to it[\s\S]*ended its turn without a handoff/);
});

test("a second failed verdict sends nothing to the crew, and the row waits under Needs you with ✗ for the coordinating thread", async () => {
  const { kit, threadId, crewThreadId, doorbells, row, verifier, handOff } = await withCrew();
  await handOff();
  await kit.call("crew_verdict", FAILS, verifier());
  await handOff();
  await kit.call("crew_verdict", FAILS, verifier());
  await settled();

  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 1, "only the first verdict went back");
  assert.deepEqual([(await row()).state, (await row()).headline], ["needs-you", "✗ Failed verification after its fix round: Retries land with backoff"]);
  assert.match(doorbells().at(-1) ?? "", /- c1 "Add retries" handed off: done, failed verification$/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /It failed verification and is yours to decide: message the crew with crew_message, replace it with a fresh crew through crew_start with supersedes/);
});

test("a verdict on a superseded or stale handoff, or of a closed crew, sends nothing to the crew and spends no round", async () => {
  const superseded = await withCrew();
  await superseded.handOff();
  const replaced = superseded.verifier();
  superseded.kit.startTurn(superseded.crewThreadId);
  await superseded.handOff();
  assert.ok(isRefusal(await superseded.kit.call("crew_verdict", FAILS, replaced)));

  const stale = await withCrew();
  await stale.handOff();
  stale.kit.startTurn(stale.crewThreadId); // the user types to the crew before its verdict
  await stale.kit.call("crew_verdict", FAILS, stale.verifier());

  const closed = await withCrew();
  await closed.handOff();
  await closed.kit.call("crew_close", { crewId: "c1", action: "resolve" }, closed.threadId);
  await closed.kit.call("crew_verdict", FAILS, closed.verifier());
  await settled();

  for (const { kit, coordinatorId, crewThreadId } of [superseded, stale, closed]) {
    assert.deepEqual(kit.sent().filter((args) => args.threadId === crewThreadId), []);
    assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 0);
  }
  for (const { kit, coordinatorId, latest } of [stale, closed]) {
    assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()).map(({ event }) => event), [{ kind: "checked", crewId: c1, handoffId: latest().id }], "the coordinating thread decides");
  }
});

test("until bb has taken the findings, the row says Verifying and the coordinating thread hears nothing; a verdict made again meanwhile is refused", async () => {
  const { kit, coordinatorId, crewThreadId, row, verifier, handOff } = await withCrew();
  await handOff();
  const verifierThreadId = verifier();
  let take = () => {};
  kit.sends.pending = new Promise((resolve) => (take = resolve));
  const returning = kit.call("crew_verdict", FAILS, verifierThreadId);
  await settled();

  assert.deepEqual([(await row()).state, kit.store.unannounced(coordinatorId)], ["verifying", []]);
  assert.ok(isRefusal(await kit.call("crew_verdict", FAILS, verifierThreadId)), "its findings go to the crew once");
  take();
  assert.match(textOf(await returning), /^Verdict recorded/);
  assert.equal(kit.delivered(crewThreadId).length, 1, "the findings, once");
  assert.deepEqual([(await row()).state, kit.store.crew(coordinatorId, c1)?.fixRounds], ["working", 1]);
});

/** Crew threads bb refuses a message to, with its answer. */
const REFUSED: ["archivedAt" | "deletedAt", string][] = [
  ["archivedAt", "HTTP 409: Thread is archived"],
  ["deletedAt", "HTTP 404: Thread not found"],
];

for (const [gone, answer] of REFUSED) {
  test(`findings bb refuses (${answer}) leave the failed verdict with the coordinating thread, spend no round, and the catch-up says bb refused them`, async () => {
    const { kit, threadId, coordinatorId, crewThreadId, doorbells, settlement, verifier, handOff } = await withCrew();
    await handOff();
    let take = () => {};
    kit.sends.pending = new Promise((resolve) => (take = resolve));
    const returning = kit.call("crew_verdict", FAILS, verifier());
    await settled();
    kit.thread(crewThreadId)[gone] = Date.now(); // the user archives or deletes the crew's thread as the findings go
    take();
    kit.sends.pending = null;
    await returning;
    await settled();

    assert.deepEqual(kit.sent().filter((args) => args.threadId === crewThreadId), [], "bb took nothing");
    assert.deepEqual(settlement(), { kind: "checked", refused: answer, ci: { kind: "none" } });
    assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 0, "the round is given back");
    assert.deepEqual(doorbells(), [`[Coordinator] 1 update. Call crew_catch_up to read it in full.\n- c1 "Add retries" handed off: done, failed verification`]);
    const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
    assert.ok(
      catchUp.includes(`bb refused the verifier's findings when the plugin sent them to the crew as its automatic fix round, so the crew never got them and the round is not spent. bb answered: ${answer}. It failed verification and is yours to decide`),
      catchUp,
    );
  });
}

test("a done handoff that supersedes a verdict while its findings are on their way leaves them sent back and counted once", async () => {
  const { kit, coordinatorId, crewThreadId, row, latest, verifier, handOff } = await withCrew();
  await handOff();
  const first = latest().id;
  let take = () => {};
  kit.sends.pending = new Promise((resolve) => (take = resolve));
  const returning = kit.call("crew_verdict", FAILS, verifier());
  await settled();

  kit.startTurn(crewThreadId); // the user asks the crew for one more change while bb takes the findings
  await handOff();
  take();
  kit.sends.pending = null;
  assert.match(textOf(await returning), /^Verdict recorded/);
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 1, "the findings, once");
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 1);
  assert.deepEqual(kit.store.unannounced(coordinatorId).map(({ event }) => event), [{ kind: "sent-back", crewId: c1, handoffId: first, round: 1 }]);

  await kit.tick();
  assert.equal(kit.store.unannounced(coordinatorId).length, 1, "the tick settles nothing again");
  await kit.call("crew_verdict", FAILS, verifier());
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 1, "nothing more goes back");
  assert.deepEqual([(await row()).state, kit.store.crew(coordinatorId, c1)?.fixRounds], ["working", 1], "the findings started the crew's next turn");
});

/** The doorbell line of a failed verdict whose findings a crash left in doubt. */
const MAYBE_SENT = `- c1 "Add retries" handed off: done, failed verification, findings may or may not have reached it`;

/** Sends that fail without proving bb refused the findings: they may or may not have reached the crew. */
const UNPROVEN: [string, Omit<SendFailure, "threadId">][] = [
  ["bb took them, then the call timed out", { error: Object.assign(new Error("BB request timed out after 75 seconds."), { name: "BbRequestTimeoutError" }), taken: true }],
  ["the connection dropped", { error: new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }), taken: true }],
  ["an error with no status", { error: new Error("socket hang up"), taken: false }],
  ["bb failed after taking them", { error: bbHttpError(500, "internal_error", "Internal Server Error"), taken: true }],
];

for (const [how, failure] of UNPROVEN) {
  test(`a send that fails without bb refusing the findings (${how}) keeps the round spent, wakes the coordinating thread, and is never sent again`, async () => {
    const { kit, threadId, coordinatorId, crewThreadId, doorbells, settlement, verifier, handOff } = await withCrew();
    await handOff();
    kit.sends.failure = { threadId: crewThreadId, ...failure };
    await kit.call("crew_verdict", FAILS, verifier());
    await settled();
    kit.sends.failure = null;

    assert.equal(kit.delivered(crewThreadId).length, failure.taken ? 1 : 0, failure.taken ? "bb took the findings" : "bb never had them");
    assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
    assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 1, "the round stays spent");
    assert.deepEqual(doorbells(), [`[Coordinator] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`], "the coordinating thread is woken");
    assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /nothing bb keeps shows whether they arrived: they may or may not have\. Read its thread with crew_read/);

    await kit.tick();
    await settled();
    assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, failure.taken ? 1 : 0, "not sent again");
    assert.deepEqual(kit.store.unannounced(coordinatorId), [], "settled once");
  });
}

test("a crash before the findings leave, then an unrelated turn in the crew's thread: the tick hands the verdict to the coordinating thread, never as sent back", async () => {
  const { kit, threadId, coordinatorId, crewThreadId, doorbells, latest, settlement, verifier, handOff } = await withCrew();
  await handOff();
  kit.sends.pending = new Promise(() => {}); // the plugin dies before bb has the findings
  void kit.call("crew_verdict", FAILS, verifier());
  await settled();
  assert.deepEqual([kit.sent().filter((args) => args.threadId === crewThreadId).length, kit.store.crew(coordinatorId, c1)?.fixRounds], [0, 1], "the round is claimed before they leave");

  kit.sends.pending = null;
  kit.reload();
  kit.startTurn(crewThreadId); // the user asks the crew something before the tick
  await kit.tick();
  await settled();
  assert.deepEqual(kit.sent().filter((args) => args.threadId === crewThreadId), [], "nothing is sent on a guess");
  assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 1, "the claim is kept");
  assert.deepEqual(doorbells(), [`[Coordinator] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`], "the coordinating thread is woken");
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /nothing bb keeps shows whether they arrived: they may or may not have\. Read its thread with crew_read/);
  assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()), [], "told once");
  await kit.tick();
  await settled();
  assert.deepEqual([kit.sent().filter((args) => args.threadId === crewThreadId).length, kit.store.unannounced(coordinatorId)], [0, []], "settled once");
  assert.equal(latest().status, "done");
});

test("findings bb queued before a crash are not sent again by the next tick", async () => {
  const { kit, coordinatorId, crewThreadId, doorbells, settlement, verifier } = await withCrew();
  await kit.call("crew_handoff", DONE, crewThreadId); // its turn is still running, so bb queues the findings
  await settled();
  kit.sends.unanswered = true;
  void kit.call("crew_verdict", FAILS, verifier());
  await settled();
  assert.deepEqual([kit.queued(crewThreadId).length, kit.delivered(crewThreadId).length, kit.store.unannounced(coordinatorId)], [1, 0, []], "bb holds them; nobody is told yet");

  kit.sends.unanswered = false;
  kit.reload();
  await kit.tick();
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 1, "not sent twice");
  assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.deepEqual(doorbells(), [`[Coordinator] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`]);

  await kit.dispatch(kit.queued(crewThreadId)[0] ?? assert.fail("nothing queued"));
  await kit.tick();
  await settled();
  assert.deepEqual([kit.delivered(crewThreadId).length, kit.sent().filter((args) => args.threadId === crewThreadId).length], [1, 1], "the crew gets them once");
});

test("findings bb delivered before a crash are not sent again by the next tick", async () => {
  const { kit, coordinatorId, crewThreadId, doorbells, settlement, verifier, handOff } = await withCrew();
  await handOff();
  kit.sends.unanswered = true;
  void kit.call("crew_verdict", FAILS, verifier());
  await settled();
  assert.equal(kit.delivered(crewThreadId).length, 1, "bb took the findings");

  kit.sends.unanswered = false;
  kit.reload();
  await kit.tick();
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 1, "not sent twice");
  assert.deepEqual(settlement(), { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 1);
  assert.deepEqual(doorbells(), [`[Coordinator] 1 update. Call crew_catch_up to read it in full.\n${MAYBE_SENT}`]);
});

test("a crew turn that starts after the models are looked up, before the decision, keeps the findings from going back", async () => {
  const { kit, coordinatorId, crewThreadId, latest, verifier, handOff } = await withCrew();
  await handOff();
  let answers = 0;
  // why the second: crew_verdict looks up the verifier's model and the crew's; the turn starts once both are answered.
  kit.modelLookups.answered = () => {
    if (++answers === 2) kit.startTurn(crewThreadId);
  };
  await kit.call("crew_verdict", FAILS, verifier());
  await settled();

  assert.equal(answers, 2);
  assert.deepEqual(kit.sent().filter((args) => args.threadId === crewThreadId), []);
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 0);
  assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()).map(({ event }) => event), [{ kind: "checked", crewId: c1, handoffId: latest().id }]);
});

test("crew_start with supersedes stops the crew and starts a fresh one with its brief, criteria and latest findings, on the model a new crew gets", async () => {
  const { kit, threadId, coordinatorId, verifier, handOff } = await withCrew();
  await handOff();
  await kit.call("crew_verdict", FAILS, verifier());
  await handOff();
  await kit.call("crew_verdict", FAILS, verifier());

  const answer = textOf(await kit.call("crew_start", { supersedes: "c1" }, threadId));
  assert.match(answer, /^c1 is stopped\. [^\n]*\n\nStarted c2 as @thread:\w+\./);
  const { spawnedWith, providerId, execution } = kit.thread(threadIn(answer));
  const prompt = spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, /^# Add retries\n/);
  assert.match(prompt, /## Brief\n\nRetry failed deliveries with backoff\.\n\n## Previous attempt's verifier findings\n\nCrew c1 worked on this before you, on its own branch, and was stopped\. Its latest verdict, on its commit `0123456`: 1 of 2 done-criteria not met\./);
  assert.match(prompt, /### 1\. npm test passes\n\n\*\*Failed\.\*\* The verifier's evidence:\n\n```\n\$ npm test\nnot ok 13 - backoff caps at 6000/);
  assert.match(prompt, /## Done when\n\n[^\n]*\n\n1\. npm test passes\n2\. npm run lint prints no errors\n/);
  assert.deepEqual([providerId, execution?.model], ["claude-code", "opus"], "the coordinating thread's, as any crew without a picked model");
  assert.equal("executionInputSources" in spawnedWith, false);
  assert.deepEqual(
    (await kit.rpc.board({ coordinatorId })).rows.map((r) => [r.crewId, r.state, r.headline]),
    [
      ["c1", "done", "Stopped"],
      ["c2", "working", "Working"],
    ],
  );
});

test("crew_start with supersedes takes a new title and brief, says when no verdict came, and refuses an unknown crew, a draft, and a new crew with fields missing", async () => {
  const { kit, threadId } = await withCrew();
  await kit.call("crew_start", { title: "Dead letters", brief: "Park undeliverable events.", doneCriteria: ["npm test passes"], draft: true }, threadId);
  const refusals: [unknown, RegExp][] = [
    [{ supersedes: "c9" }, /You have no crew c9/],
    [{ supersedes: "c2" }, /c2 is a draft that never ran/],
    [{ title: "Retries" }, /needs a title, a brief and doneCriteria to start a new crew/],
  ];
  for (const [input, reason] of refusals) {
    const result = await kit.call("crew_start", input, threadId);
    assert.ok(isRefusal(result), String(reason));
    assert.match(textOf(result), reason);
  }
  assert.equal(kit.store.crews(kit.store.coordinators()[0]?.id ?? assert.fail("no coordinator")).length, 2, "nothing was saved");

  const answer = textOf(await kit.call("crew_start", { supersedes: "c1", title: "Retries, take 2", brief: "Use the queue's own retry." }, threadId));
  const prompt = kit.thread(threadIn(answer)).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, /^# Retries, take 2\n/);
  assert.match(prompt, /## Brief\n\nUse the queue's own retry\.\n\n## Previous attempt's verifier findings\n\nCrew c1 worked on this before you and was stopped\. No verifier returned a verdict on its work\./);
  assert.doesNotMatch(prompt, /Retry failed deliveries/);
});

test("crew_start with supersedes starts nothing while the old crew's thread is still stopping", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ stops: "stopping" });
  await kit.call("crew_start", { title: "Add retries", brief: "Retry failed deliveries with backoff.", doneCriteria: CRITERIA }, threadId);
  const answer = textOf(await kit.call("crew_start", { supersedes: "c1" }, threadId));
  assert.match(answer, /^Asked c1 to stop, but its thread is still stopping, so nothing was replaced and no crew started\./);
  assert.deepEqual(kit.store.crews(coordinatorId).map((crew) => [crew.id, crew.closed]), [["c1", null]]);
});

test("a verdict that passes every criterion is Ready for review with ✓ and the models bb ran the verifier on", async () => {
  const { kit, doorbells, row, verifier, handOff } = await withCrew();
  await handOff();
  await kit.call("crew_verdict", PASSES, verifier());
  await settled();

  const passed = await row();
  assert.deepEqual([passed.state, passed.headline], ["ready-for-review", "✓ Verified: Retries land with backoff"]);
  assert.ok(passed.verdict?.state === "returned");
  assert.deepEqual([passed.verdict.model, passed.verdict.sameModel], [{ providerId: "codex", model: "gpt-default" }, false]);
  assert.deepEqual(
    passed.verdict.criteria.map((check) => [check.criterion, check.result]),
    CRITERIA.map((criterion) => [criterion, "pass"]),
  );
  assert.match(doorbells()[0] ?? "", /handed off: done, verified$/);
});

test("crew_verdict refuses a caller that is not this handoff's verifier, a skipped, repeated or unknown criterion, and a pass on the wrong commit", async () => {
  const { kit, threadId, crewThreadId, verdict, verifier, handOff } = await withCrew();
  await handOff();
  const [first, second] = PASSES.criteria;
  const refusals: [string, unknown, RegExp][] = [
    [threadId, PASSES, /only a verifier thread/],
    [crewThreadId, PASSES, /only a verifier thread/],
    [verifier(), { ...PASSES, criteria: [first] }, /missing 2 of 1 to 2/],
    [verifier(), { ...PASSES, criteria: [first, first, second] }, /1 appears more than once/],
    [verifier(), { ...PASSES, criteria: [first, second, { ...second, criterion: 3 }] }, /only 2 done-criteria; 3 is not one/],
    [verifier(), { ...PASSES, headSha: "f".repeat(40) }, /HEAD was f{40}, not the claimed 0123/],
  ];
  for (const [caller, input, reason] of refusals) {
    const result = await kit.call("crew_verdict", input, caller);
    assert.ok(isRefusal(result), String(reason));
    assert.match(textOf(result), reason);
  }
  assert.equal(verdict().state, "running");

  const wrongCommit = { ...FAILS, headSha: "f".repeat(40), criteria: FAILS.criteria.map((check) => ({ ...check, result: "fail" })) };
  assert.ok(!isRefusal(await kit.call("crew_verdict", wrongCommit, verifier())), "the wrong commit with every criterion failed is a verdict");
});

test("a second verdict from the same verifier is refused, and the first stands", async () => {
  const { kit, verdict, verifier, handOff } = await withCrew();
  await handOff();
  const verifierThreadId = verifier();
  await kit.call("crew_verdict", FAILS, verifierThreadId);
  const result = await kit.call("crew_verdict", PASSES, verifierThreadId);
  assert.ok(isRefusal(result));
  assert.match(textOf(result), /no longer waits for your verdict/);
  const stands = verdict();
  assert.deepEqual(stands.state === "returned" && stands.criteria.map((check) => check.result), ["fail", "pass"]);
});

test("with the switch off a done handoff starts no verifier and reads Unverified; switching it back on leaves that row alone", async () => {
  const { kit, coordinatorId, doorbells, row, verdict, handOff } = await withCrew({ verify: false });
  const spawned = kit.spawned();
  assert.match(await handOff(), /marked unverified: verification is off/);
  assert.equal(kit.spawned(), spawned, "no verifier");
  assert.deepEqual(verdict(), { state: "waived" });
  assert.deepEqual([(await row()).state, (await row()).headline], ["ready-for-review", "Unverified: Retries land with backoff"]);
  assert.match(doorbells()[0] ?? "", /handed off: done, unverified$/);

  await kit.rpc.setVerify({ coordinatorId, verify: true });
  await kit.tick();
  await settled();
  assert.equal(kit.spawned(), spawned, "turning it on checks no earlier handoff");
  assert.deepEqual([(await row()).state, (await row()).headline, verdict()], ["ready-for-review", "Unverified: Retries land with backoff", { state: "waived" }]);
  assert.match(doorbells().at(-1) ?? "", /The user turned verification of done handoffs on$/);
  assert.deepEqual((await kit.rpc.board({ coordinatorId })).verify, true);
});

test("the switch applies to handoffs made after it, and setting it to what it is records nothing", async () => {
  const { kit, coordinatorId, crewThreadId, verdict, handOff } = await withCrew();
  await kit.rpc.setVerify({ coordinatorId, verify: true });
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);

  await kit.rpc.setVerify({ coordinatorId, verify: false });
  assert.equal((await kit.rpc.board({ coordinatorId })).verify, false);
  await handOff();
  assert.deepEqual(verdict(), { state: "waived" });

  await kit.rpc.setVerify({ coordinatorId, verify: true });
  kit.startTurn(crewThreadId);
  await handOff();
  assert.equal(verdict().state, "running");
});

test("a verdict whose verifier never started is started by the next tick", async () => {
  const { kit, coordinatorId, crewThreadId, verdict } = await withCrew();
  // As if the plugin reloaded between storing the handoff and starting its verifier.
  const id = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e");
  const turnSeq = kit.thread(crewThreadId).turns.at(-1) ?? assert.fail("no turn");
  kit.inbox.handoff({ id, coordinatorId, crewId: c1, at: Date.now(), turnSeq, ...DONE, status: "done", prUrl: null });
  const spawned = kit.spawned();
  assert.deepEqual(verdict(), { state: "queued" });

  await kit.tick();
  assert.equal(kit.spawned(), spawned + 1);
  const started = verdict();
  assert.equal(started.state, "running");
  assert.equal(kit.thread(started.state === "running" ? started.verifierThreadId : "").spawnedWith.parentThreadId, crewThreadId);
  await kit.tick();
  assert.equal(kit.spawned(), spawned + 1, "a running verifier is not started again");
});

test("a verifier that goes idle without a verdict is nudged once, then the row reads Couldn't verify under Needs you", async () => {
  const { kit, doorbells, row, verdict, verifier, handOff } = await withCrew();
  await handOff();
  const verifierThreadId = verifier();
  await kit.tick();
  assert.deepEqual(kit.delivered(verifierThreadId), [], "a verifier still working is left alone");

  await kit.idle(verifierThreadId, "All good.");
  await kit.tick();
  assert.match(kit.delivered(verifierThreadId).join(), /without calling crew_verdict/);
  assert.equal(verdict().state, "running");
  await kit.tick();
  assert.equal(kit.delivered(verifierThreadId).length, 1, "nudged once, while it works on the nudge");

  await kit.idle(verifierThreadId, "Still all good.");
  await kit.tick();
  await settled();
  assert.deepEqual(verdict(), { state: "could-not-run", verifierThreadId, reason: "its verifier stopped without a verdict twice, the second time after a reminder" });
  assert.deepEqual([(await row()).state, (await row()).headline], ["needs-you", "Couldn't verify: Retries land with backoff"]);
  assert.match(doorbells()[0] ?? "", /handed off: done, could not be verified$/);
  assert.ok(isRefusal(await kit.call("crew_verdict", PASSES, verifierThreadId)), "a verdict after giving up is refused");
});

test("a verifier whose thread is archived is given up on at the next tick", async () => {
  const { kit, verdict, verifier, handOff } = await withCrew();
  await handOff();
  const verifierThreadId = verifier();
  kit.thread(verifierThreadId).archivedAt = Date.now();
  await kit.tick();
  assert.deepEqual(verdict(), { state: "could-not-run", verifierThreadId, reason: "its verifier thread was archived or deleted before it returned a verdict" });
});

test("a second done handoff supersedes the first verdict and stops its verifier, whose verdict is then refused", async () => {
  const { kit, coordinatorId, crewThreadId, doorbells, latest, verifier, handOff } = await withCrew();
  await handOff();
  const first = latest();
  const firstVerifier = verifier();

  kit.startTurn(crewThreadId); // the user asks the crew for one more change
  await handOff();
  const replaced = kit.store.handoff(first.id);
  assert.deepEqual(replaced?.status === "done" && replaced.verdict, { state: "superseded" });
  assert.equal(kit.thread(firstVerifier).status, "idle", "stopped");
  assert.notEqual(verifier(), firstVerifier);

  assert.ok(isRefusal(await kit.call("crew_verdict", PASSES, firstVerifier)));
  await kit.call("crew_verdict", PASSES, verifier());
  await settled();
  assert.equal(doorbells().length, 1, "only the newer handoff is announced");
  assert.deepEqual(
    kit.store.takeUnread(coordinatorId, Date.now()).map(({ event }) => event.kind === "checked" && event.handoffId),
    [latest().id],
  );
});

test("a verifier bb won't start leaves the row Couldn't verify, with bb's reason; one whose answer alone was lost runs", async () => {
  const lost = await withCrew();
  lost.kit.spawns.created = false;
  lost.kit.spawns.answer = "lost";
  await lost.handOff();
  assert.deepEqual(lost.verdict(), { state: "could-not-run", verifierThreadId: null, reason: "bb did not start a verifier: socket hang up" });
  assert.equal((await lost.row()).headline, "Couldn't verify: Retries land with backoff");
  assert.match(lost.doorbells()[0] ?? "", /could not be verified$/);

  const bound = await withCrew();
  bound.kit.spawns.answer = "lost";
  await bound.handOff();
  assert.equal(bound.verdict().state, "running", "bound through thread.created");
});

test("the verifier runs on the Coordinator's model when the crew's differs", async () => {
  const { kit, threadId, verifier, handOff } = await withCrew();
  const coordinator = kit.thread(threadId).execution ?? assert.fail("no execution");
  coordinator.model = "sonnet"; // the Coordinator's latest turn ran on another model than its crew's
  await handOff();
  assert.deepEqual([kit.thread(verifier()).providerId, kit.thread(verifier()).execution?.model], ["claude-code", "sonnet"]);
});

test("with no other provider the verifier runs on another model of the crew's, then on the crew's own, which its verdict says", async () => {
  const sibling = await withCrew();
  sibling.kit.providers.list = sibling.kit.providers.list.filter((provider) => provider.id === "claude-code");
  await sibling.handOff();
  assert.deepEqual([sibling.kit.thread(sibling.verifier()).providerId, sibling.kit.thread(sibling.verifier()).execution?.model], ["claude-code", "sonnet"]);

  const alone = await withCrew();
  alone.kit.providers.list = [
    { id: "claude-code", available: true, models: [{ model: "opus", isDefault: true, defaultReasoningEffort: "high" }] },
    { id: "codex", available: true, models: null },
    { id: "pi", available: false, models: [{ model: "pi-1", isDefault: true, defaultReasoningEffort: "low" }] },
  ];
  await alone.handOff();
  assert.deepEqual([alone.kit.thread(alone.verifier()).providerId, alone.kit.thread(alone.verifier()).execution?.model], ["claude-code", "opus"]);
  await alone.kit.call("crew_verdict", PASSES, alone.verifier());
  const row = await alone.row();
  assert.ok(row.verdict?.state === "returned");
  assert.equal(row.verdict.sameModel, true);
});

test("no registered tool can change whether a Coordinator verifies, whoever calls it with whatever input", async () => {
  const { kit, threadId, coordinatorId, crewThreadId, verifier, handOff } = await withCrew();
  await handOff();
  const callers = [threadId, crewThreadId, verifier()];
  const inputs = [{}, { verify: false }, { coordinatorId, verify: false }, { crewId: "c1", verify: false, enabled: false }];
  for (const { name, parameters } of kit.tools()) {
    // why keys only: a value such as the result "unverifiable" is no way in.
    assert.doesNotMatch(JSON.stringify(z.toJSONSchema(parameters, { io: "input" })), /"[^"]*verif[^"]*":/i, `${name} takes no field about verification`);
    for (const caller of callers) for (const input of inputs) await kit.call(name, input, caller).catch(() => undefined);
  }
  assert.equal(kit.store.verifies(coordinatorId), true);
  assert.ok(!kit.store.takeUnread(coordinatorId, Date.now()).some(({ event }) => event.kind === "verification-toggled"));
});
