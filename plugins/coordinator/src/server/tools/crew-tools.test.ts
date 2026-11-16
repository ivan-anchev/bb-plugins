import assert from "node:assert/strict";
import { test } from "node:test";
import { crewIdSchema } from "../../model/role.ts";
import { coordinating, isRefusal, textOf, threadIn } from "../test-harness.ts";

const RETRIES = { title: "Add retries", brief: "Retry failed webhook deliveries with backoff.", doneCriteria: ["npm test passes"] };
const REPORT = { summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };
const DONE = { status: "done", ...REPORT, headSha: "0123456789abcdef0123456789abcdef01234567" };
const c1 = crewIdSchema.parse("c1");

async function withCrew({ verify = true } = {}) {
  const { kit, threadId, coordinatorId } = await coordinating({ verify });
  const crewThreadId = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));
  return { kit, threadId, coordinatorId, crewThreadId };
}

test("crew_handoff from a thread that is not a crew is refused, and nothing is stored or rung", async () => {
  const { kit, threadId, coordinatorId } = await withCrew();
  for (const caller of [threadId, "thr_forged"]) {
    const result = await kit.call("crew_handoff", DONE, caller);
    assert.ok(isRefusal(result), caller);
    assert.match(textOf(result), /crew_handoff is refused: only a crew thread/);
  }
  assert.equal(kit.store.latestHandoff(coordinatorId, c1), null);
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);
  assert.deepEqual(kit.sent(), []);
});

test("a handoff is stored whole, trimmed, with its turn and a waived verdict, and reads back as written", async () => {
  const { kit, coordinatorId, crewThreadId } = await withCrew({ verify: false });
  const result = await kit.call("crew_handoff", { ...DONE, summary: "  Retries land with backoff ", prUrl: "https://github.com/acme/webhooks/pull/7" }, crewThreadId);
  assert.match(textOf(result), /^Handed off\. Your coordinator has your report, marked unverified/);

  const { id, at, ...stored } = kit.store.latestHandoff(coordinatorId, c1) ?? assert.fail("no handoff stored");
  assert.deepEqual(stored, {
    coordinatorId,
    crewId: c1,
    turnSeq: kit.thread(crewThreadId).turns.at(-1),
    ...DONE,
    status: "done",
    prUrl: "https://github.com/acme/webhooks/pull/7",
    verdict: { state: "waived" },
  });
  assert.deepEqual(kit.store.handoff(id), kit.store.latestHandoff(coordinatorId, c1));
});

test("a crew's latest handoff is its newest, never another crew's, and an earlier one still reads by its id", async () => {
  const { kit, threadId, coordinatorId, crewThreadId } = await withCrew();
  const otherThreadId = threadIn(textOf(await kit.call("crew_start", { ...RETRIES, title: "Dead letters" }, threadId)));
  await kit.call("crew_handoff", { ...REPORT, status: "blocked" }, crewThreadId);
  const blocked = kit.store.latestHandoff(coordinatorId, c1) ?? assert.fail("no handoff stored");
  kit.startTurn(crewThreadId);
  await kit.call("crew_handoff", DONE, crewThreadId);
  await kit.call("crew_handoff", { ...REPORT, status: "gave-up" }, otherThreadId);

  assert.equal(kit.store.latestHandoff(coordinatorId, c1)?.status, "done");
  assert.equal(kit.store.latestHandoff(coordinatorId, crewIdSchema.parse("c2"))?.status, "gave-up");
  assert.deepEqual(kit.store.handoff(blocked.id), blocked);
});

test("a handoff outside its bounds is rejected, and a done one needs its commit", async () => {
  const { kit, coordinatorId, crewThreadId } = await withCrew();
  const { headSha: _, ...doneWithoutCommit } = DONE;
  for (const input of [
    doneWithoutCommit,
    { ...DONE, headSha: "abc123" },
    { ...DONE, summary: "x".repeat(121) },
    { ...DONE, summary: "Two\nlines" },
    { ...DONE, evidence: Array.from({ length: 51 }, () => "ran it") },
    { ...DONE, evidence: ["x".repeat(2_001)] },
    { ...DONE, prUrl: "javascript:alert(1)" },
    { ...DONE, status: "finished" },
  ]) {
    await assert.rejects(kit.call("crew_handoff", input, crewThreadId));
  }
  assert.equal(kit.store.latestHandoff(coordinatorId, c1), null);

  assert.ok(!isRefusal(await kit.call("crew_handoff", { ...REPORT, status: "blocked" }, crewThreadId)), "blocked needs no commit");
});

test("a closed crew's handoff is refused", async () => {
  const { kit, threadId, coordinatorId, crewThreadId } = await withCrew();
  await kit.call("crew_close", { crewId: "c1", action: "resolve" }, threadId);
  const result = await kit.call("crew_handoff", DONE, crewThreadId);
  assert.ok(isRefusal(result));
  assert.match(textOf(result), /closed you as resolved/);
  assert.equal(kit.store.latestHandoff(coordinatorId, c1), null);
});

test("with verification off, once its turn ends a done handoff is Ready for review as Unverified, and a blocked or gave-up one Needs you", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const crews: [string, Record<string, unknown>][] = [];
  for (const [title, input] of [
    ["Done", DONE],
    ["Blocked", { ...REPORT, status: "blocked", summary: "Needs a staging key" }],
    ["Gave up", { ...REPORT, status: "gave-up", summary: "The queue API rejects batches" }],
  ] as const) {
    crews.push([threadIn(textOf(await kit.call("crew_start", { ...RETRIES, title }, threadId))), input]);
  }
  for (const [crewThreadId, input] of crews) {
    await kit.call("crew_handoff", input, crewThreadId);
    await kit.idle(crewThreadId, "Handed off.");
  }

  assert.deepEqual((await kit.rpc.board({ coordinatorId })).rows.map((row) => [row.crewId, row.state, row.headline]), [
    ["c1", "ready-for-review", "Unverified: Retries land with backoff"],
    ["c2", "needs-you", "Blocked: Needs a staging key"],
    ["c3", "needs-you", "Gave up: The queue API rejects batches"],
  ]);
});

test("a handoff of 50 evidence items of 2,000 characters comes back whole from crew_catch_up and crew_read", async () => {
  const { kit, threadId, crewThreadId } = await withCrew({ verify: false });
  // Each item is numbered at its start and ends in "$", so a missing or cut one can't match.
  const evidence = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(2, "0")}${"e".repeat(1_997)}$`);
  await kit.call("crew_handoff", { ...DONE, evidence }, crewThreadId);

  for (const text of [textOf(await kit.call("crew_catch_up", {}, threadId)), textOf(await kit.call("crew_read", { crewId: "c1" }, threadId))]) {
    for (const item of evidence) assert.ok(text.includes(`- ${item}`), `item ${item.slice(0, 2)} is missing or cut`);
    assert.match(text, /Status: done\nSummary: Retries land with backoff\nCommit: 0123456789abcdef0123456789abcdef01234567\nPull request: none/);
    assert.match(text, /#### Verdict\n\nUnverified: verification was off, so nobody has checked it against the done-criteria\./);
  }
});

test("crew_read says when the crew has had a turn since its latest handoff", async () => {
  const { kit, threadId, crewThreadId } = await withCrew();
  await kit.call("crew_handoff", DONE, crewThreadId);
  assert.doesNotMatch(textOf(await kit.call("crew_read", { crewId: "c1" }, threadId)), /had a turn since/);

  kit.startTurn(crewThreadId);
  assert.match(textOf(await kit.call("crew_read", { crewId: "c1" }, threadId)), /### Its latest handoff\n\nIts thread has had a turn since, so this no longer places it on the board\.\n\nStatus: done/);
});
