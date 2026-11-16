import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema } from "../../model/handoff.ts";
import { crewIdSchema } from "../../model/role.ts";
import type { Verdict } from "../../model/verdict.ts";
import { coordinating, isRefusal, settled, textOf, threadIn } from "../test-harness.ts";

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
  /** The crew hands off as done and ends its turn. */
  async function handOff(): Promise<string> {
    const answer = textOf(await kit.call("crew_handoff", DONE, crewThreadId));
    await kit.idle(crewThreadId, "Handed off.");
    await settled();
    return answer;
  }
  return { kit, threadId, coordinatorId, crewThreadId, doorbells, row, latest, verdict, verifier, handOff };
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

test("a failing criterion: the row goes Verifying, then Needs you, and the doorbell comes only with the verdict, which holds the test output", async () => {
  const { kit, threadId, coordinatorId, doorbells, row, verifier, handOff } = await withCrew();
  await handOff();
  assert.deepEqual([(await row()).state, (await row()).headline], ["verifying", "Verifying: Retries land with backoff"]);
  assert.deepEqual(doorbells(), [], "no doorbell before the verdict");
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);

  assert.match(textOf(await kit.call("crew_verdict", FAILS, verifier())), /^Verdict recorded: 1 of 2 criteria passed\./);
  await settled();
  assert.deepEqual(doorbells(), [`[Coordinator] 1 update. Call crew_catch_up to read it in full.\n- c1 "Add retries" handed off: done, failed verification`]);
  const failed = await row();
  assert.deepEqual([failed.state, failed.headline], ["needs-you", "✗ Failed verification: Retries land with backoff"]);
  assert.equal(failed.verdict?.state, "returned");
  assert.deepEqual(failed.verdict?.state === "returned" && failed.verdict.criteria[0], { criterion: "npm test passes", result: "fail", evidence: FAILS.criteria[0]?.evidence });
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /Failed verification: 1 of 2 criteria passed[\s\S]*1\. FAIL: npm test passes\n {3}\$ npm test\n {3}not ok 13 - backoff caps at 6000/);
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
