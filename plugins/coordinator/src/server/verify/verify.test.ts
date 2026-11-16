import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema } from "../../model/handoff.ts";
import { crewIdSchema } from "../../model/role.ts";
import { outcome, type Verdict } from "../../model/verdict/verdict.ts";
import { memoryStorage } from "../memory-storage.ts";
import { bbHttpError, coordinating, HEAD, isRefusal, settled, textOf, threadIn, type SendFailure } from "../test-harness.ts";

const c1 = crewIdSchema.parse("c1");
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

/** A Coordinator with one crew, both idle, so a doorbell starts the Coordinator's turn. */
async function withCrew(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
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

test("a verifier's brief holds the claimed commit, the plugin's read of it, and every criterion numbered, and none of the crew's own report", async () => {
  const { kit, verifier, handOff } = await withCrew();
  await handOff();
  const prompt = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, new RegExp(`## The commit and the tree, as the plugin read them\n\nbb's git plugin read the crew's environment as it handed off: the claimed commit ${HEAD} checked out, on a clean working tree\. The plugin judges the commit and the tree itself`));
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

// QA-03: a Claude Code verifier's per-command sandbox showed a boat sandbox's home dotfiles as
// untracked, and its own "the tree is clean" check failed clean work and spent the fix round.
test("a crew bb reads at the claimed commit on a clean tree is judged on its criteria alone, and its verifier is never asked to check the commit or the tree", async () => {
  const { kit, coordinatorId, crewThreadId, row, verifier, handOff } = await withCrew();
  await handOff();
  const verifierThreadId = verifier();
  const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "skills", "verifying", "SKILL.md"), "utf8");
  const asked = [kit.thread(verifierThreadId).spawnedWith.prompt, kit.configurationFor(verifierThreadId, {}).instructions, skill].join("\n");
  assert.doesNotMatch(asked, /git status|rev-parse|porcelain/, "nothing tells the verifier to run git to check the commit or the tree");
  const parameters = kit.tools().find((tool) => tool.name === "crew_verdict")?.parameters ?? assert.fail("no crew_verdict");
  assert.equal(JSON.stringify(z.toJSONSchema(parameters)).includes("headSha"), false, "crew_verdict asks for no commit");

  await kit.call("crew_verdict", PASSES, verifierThreadId);
  await settled();
  assert.deepEqual([(await row()).state, (await row()).headline], ["ready-for-review", "✓ Verified: Retries land with backoff"]);
  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 0, "nothing went back to the crew");
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 0);
});

test("a tree bb reads with changes fails the verdict with bb's evidence, whatever the criteria say, and goes back to the crew as its fix round", async () => {
  const { kit, threadId, coordinatorId, crewThreadId, row, verifier, handOff } = await withCrew();
  kit.git.changedFiles.set(kit.thread(crewThreadId).environmentId ?? assert.fail("no environment"), 2);
  await handOff();
  const prompt = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(prompt, /the working tree had 2 changed files: \?\? scratch-1\.txt, \?\? scratch-2\.txt\. The plugin judges[^\n]*This already fails the verdict, whatever you find; check every criterion anyway/);

  await kit.call("crew_verdict", PASSES, verifier());
  await settled();
  const findings = kit.delivered(crewThreadId).at(-1) ?? assert.fail("nothing reached the crew");
  assert.match(findings, /^## Verifier findings: every done-criterion passed, and the claimed commit wasn't checked out on a clean tree\n/);
  assert.match(findings, /### The commit and the tree\n\nbb's git plugin read the crew's environment as it handed off: the working tree had 2 changed files: \?\? scratch-1\.txt, \?\? scratch-2\.txt\. Commit what belongs/);
  assert.deepEqual([(await row()).state, (await row()).headline], ["working", "Working"], "the crew works again, on its one fix round");
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 1);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /Failed verification: 2 of 2 criteria passed[^\n]*bb's git plugin read the crew's environment as it handed off: the working tree had 2 changed files/);

  // The fix round works as before: the crew cleans up and hands off again, and a clean pass is verified.
  kit.git.changedFiles.clear();
  await handOff();
  await kit.call("crew_verdict", PASSES, verifier());
  await settled();
  assert.deepEqual([(await row()).state, (await row()).headline], ["ready-for-review", "✓ Verified: Retries land with backoff"]);
});

test("a commit bb reads other than the claimed one fails the verdict with bb's evidence; failing again after the fix round goes to the coordinating thread", async () => {
  const { kit, crewThreadId, row, verifier, handOff } = await withCrew();
  kit.git.heads.set(kit.thread(crewThreadId).environmentId ?? assert.fail("no environment"), "f".repeat(40));
  await handOff();
  await kit.call("crew_verdict", PASSES, verifier());
  await settled();
  assert.match(kit.delivered(crewThreadId).at(-1) ?? "", new RegExp(`HEAD was f{40}, not the claimed ${HEAD}\\.`));

  await handOff();
  await kit.call("crew_verdict", PASSES, verifier());
  await settled();
  assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 1, "only the first verdict went back");
  assert.deepEqual([(await row()).state, (await row()).headline], ["needs-you", "✗ Failed verification after its fix round: Retries land with backoff"]);
  const shown = (await row()).verdict;
  assert.ok(shown?.state === "returned");
  assert.deepEqual(shown.checkout, { headSha: "f".repeat(40), changedFiles: [], changedFileCount: 0 }, "the board has bb's read to show");
});

test("a checkout bb's git plugin can't read is Couldn't verify at once: no verifier, nothing sent to the crew, no fix round spent", async () => {
  const cases: [string, (kit: Awaited<ReturnType<typeof withCrew>>["kit"], environmentId: string) => void, RegExp][] = [
    ["its machine offline", (kit, id) => kit.git.offline.add(id), /\(The environment's machine is offline\)/],
    ["not a git repository", (kit, id) => kit.git.nonGit.add(id), /\(the environment is not a git repository\)/],
    ["an answer the plugin can't read", (kit, id) => kit.git.newer.set(id, { outcome: "rebasing" }), /\(bb's git plugin answered "rebasing" in a shape this plugin can't read\)/],
    ["no commit named", (kit, id) => kit.git.newer.set(id, { outcome: "available", workspace: { checkout: { kind: "unborn", branchName: "main" }, workingTree: { fileCount: 0, files: [] } } }), /\(it named no commit checked out\)/],
  ];
  for (const [name, unreadable, reason] of cases) {
    const { kit, threadId, coordinatorId, crewThreadId, doorbells, row, verdict, handOff } = await withCrew();
    unreadable(kit, kit.thread(crewThreadId).environmentId ?? assert.fail("no environment"));
    const spawned = kit.spawned();
    assert.match(await handOff(), /marked couldn't verify: bb's git plugin couldn't read the crew's commit and working tree/, name);

    const current = verdict();
    assert.ok(current.state === "could-not-run", name);
    assert.match(current.reason, reason, name);
    assert.equal(kit.spawned(), spawned, `${name}: no verifier`);
    await kit.tick();
    await settled();
    assert.equal(kit.sent().filter((args) => args.threadId === crewThreadId).length, 0, `${name}: nothing went back to the crew`);
    assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 0, `${name}: no fix round spent`);
    assert.deepEqual([(await row()).state, (await row()).headline], ["needs-you", "Couldn't verify: Retries land with backoff"], name);
    assert.match(doorbells().at(-1) ?? "", /handed off: done, could not be verified$/, name);
    assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /Couldn't verify: bb's git plugin couldn't read the crew's commit and working tree as it handed off/, name);
  }
});

test("crew_verdict refuses a caller that is not this handoff's verifier, and a skipped, repeated or unknown criterion", async () => {
  const { kit, threadId, crewThreadId, verdict, verifier, handOff } = await withCrew();
  await handOff();
  const [first, second] = PASSES.criteria;
  const refusals: [string, unknown, RegExp][] = [
    [threadId, PASSES, /only a verifier thread/],
    [crewThreadId, PASSES, /only a verifier thread/],
    [verifier(), { ...PASSES, criteria: [first] }, /missing 2 of 1 to 2/],
    [verifier(), { ...PASSES, criteria: [first, first, second] }, /1 appears more than once/],
    [verifier(), { ...PASSES, criteria: [first, second, { ...second, criterion: 3 }] }, /only 2 done-criteria; 3 is not one/],
  ];
  for (const [caller, input, reason] of refusals) {
    const result = await kit.call("crew_verdict", input, caller);
    assert.ok(isRefusal(result), String(reason));
    assert.match(textOf(result), reason);
  }
  assert.equal(verdict().state, "running");
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
  const checkout = { headSha: HEAD, changedFiles: [], changedFileCount: 0 };
  kit.inbox.handoff({ id, coordinatorId, crewId: c1, at: Date.now(), turnSeq, ...DONE, status: "done", prUrl: null }, { kind: "read", checkout });
  const spawned = kit.spawned();
  assert.deepEqual(verdict(), { state: "queued", checkout });

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

test("a verifier whose sandbox was removed before its verdict reads Couldn't verify at the next tick, with no reminder sent", async () => {
  const { kit, doorbells, row, verdict, verifier, handOff } = await withCrew();
  await handOff();
  const verifierThreadId = verifier();
  // As bb leaves it when the machine is removed: the environment destroyed, the verifier's start failed.
  kit.environments.destroyed.add(kit.thread(verifierThreadId).environmentId);
  kit.thread(verifierThreadId).status = "error";
  await kit.tick();
  await settled();
  assert.deepEqual(verdict(), {
    state: "could-not-run",
    verifierThreadId,
    reason: "the crew's environment was removed (a sandbox removed or reaped) before its verifier returned a verdict",
  });
  assert.deepEqual(kit.delivered(verifierThreadId), [], "no reminder to a thread that can't run");
  assert.deepEqual([(await row()).state, (await row()).headline], ["needs-you", "Couldn't verify: Retries land with backoff"]);
  assert.match(doorbells()[0] ?? "", /handed off: done, could not be verified$/);
});

test("after an upgrade, a verifier already checking and a verdict still waiting for one reach the Coordinator as couldn't verify, with no new verifier or fix round, and the late verdict never passes", async () => {
  // The release that first read the crew's checkout, until it is upgraded: its database without the migrations after that.
  const { db, storage } = memoryStorage();
  let upgraded = false;
  const throughFirstRead = (statements: string[]) => statements.slice(0, statements.findIndex((statement) => statement.includes("'$.checkout'")) + 1);
  const { kit, threadId, coordinatorId, doorbells, verdict, verifier, handOff } = await withCrew({ storage: { ...storage, migrate: (handle, statements) => storage.migrate(handle, upgraded ? statements : throughFirstRead(statements)) } });
  const c2 = crewIdSchema.parse("c2");
  await kit.call("crew_start", { title: "Count deliveries", brief: "Count every delivery.", doneCriteria: CRITERIA }, threadId);
  await handOff();
  // c1's verifier started on that release's brief; c2's handoff is queued for a verifier it hadn't started.
  const running = verifier();
  const queued = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d55");
  db.prepare("INSERT INTO handoffs (id, coordinator_id, crew_id, report, turn_seq, at) VALUES (?, ?, ?, ?, 1, ?)").run(queued, coordinatorId, c2, JSON.stringify({ ...DONE, prUrl: null }), kit.clock.now);
  db.prepare("INSERT INTO verdicts (handoff_id, verdict) VALUES (?, ?)").run(queued, JSON.stringify({ state: "queued", checkout: { headSha: HEAD, changedFiles: [], changedFileCount: 0 } }));
  const spawned = kit.spawned();

  upgraded = true;
  kit.reload();
  await kit.tick();
  await settled();

  assert.equal(kit.spawned(), spawned, "no verifier starts on a checkout nothing shows was checked");
  const c2Handoff = kit.store.handoff(queued);
  assert.ok(c2Handoff?.status === "done");
  assert.equal(c2Handoff.verdict.state, "could-not-run");
  assert.equal(verdict().state, "could-not-run");
  assert.deepEqual([kit.store.crew(coordinatorId, c1)?.fixRounds, kit.store.crew(coordinatorId, c2)?.fixRounds], [0, 0], "no fix round is spent");
  assert.match(doorbells().join("\n"), /c1 "Add retries" handed off: done, could not be verified/);
  assert.match(doorbells().join("\n"), /c2 "Count deliveries" handed off: done, could not be verified/);

  assert.ok(isRefusal(await kit.call("crew_verdict", PASSES, running)), "the verifier's late verdict is refused");
  await kit.tick();
  await settled();
  assert.equal(outcome(verdict()), "could-not-run", "never a pass on its criteria alone");
});

test("a reload while the tick reads a quiet verifier's environment leaves its one reminder to the new instance", async () => {
  const { kit, verdict, verifier, handOff } = await withCrew();
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
