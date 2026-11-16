import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffIdSchema } from "../model/handoff.ts";
import { coordinatorIdSchema, crewIdSchema } from "../model/role.ts";
import { memoryStorage } from "./memory-storage.ts";
import { openStore } from "./store.ts";

const ID = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");

function storeWithTicket() {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: ID, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
  return store;
}

test("a ticket binds once: a second bind, to the same or another thread, changes nothing", () => {
  const store = storeWithTicket();

  assert.deepEqual(store.bindTicket("ticket-1", "thr_a"), { kind: "coordinator", coordinatorId: ID });
  assert.equal(store.bindTicket("ticket-1", "thr_a"), null);
  assert.equal(store.bindTicket("ticket-1", "thr_b"), null);
  assert.deepEqual(store.roleOfThread("thr_a"), { kind: "coordinator", coordinatorId: ID });
  assert.equal(store.roleOfThread("thr_b"), null);
});

test("an unbound coordinator is not listed until its thread is bound", () => {
  const store = storeWithTicket();
  assert.deepEqual(store.coordinators(), []);

  store.bindTicket("ticket-1", "thr_a");
  assert.deepEqual(store.coordinators(), [{ id: ID, threadId: "thr_a", projectId: "prj_1", verify: true, createdAt: 1_000 }]);
});

test("an unbound ticket configures only while unbound", () => {
  const store = storeWithTicket();
  assert.equal(store.roleFor("thr_a", "ticket-1")?.kind, "coordinator");
  assert.equal(store.roleFor("thr_a", "invented"), null);

  store.bindTicket("ticket-1", "thr_a");
  assert.equal(store.roleFor("thr_b", "ticket-1"), null);
  assert.equal(store.roleFor("thr_a", null)?.kind, "coordinator");
});

const crewInput = (ticket: string) => ({ coordinatorId: ID, ticket, title: "Retries", brief: "Retry deliveries.", doneCriteria: ["npm test passes"], placement: { kind: "worktree" } as const, execution: null, createdAt: 2_000 });

test("crews are numbered c1, c2… within their coordinating thread, and are drafts until their ticket binds", () => {
  const store = storeWithTicket();
  assert.equal(store.insertCrew(crewInput("crew-1")), "c1");
  assert.equal(store.insertCrew(crewInput("crew-2")), "c2");
  assert.deepEqual(store.crews(ID).map((crew) => [crew.id, crew.launch]), [["c1", { kind: "draft" }], ["c2", { kind: "draft" }]]);

  assert.deepEqual(store.bindTicket("crew-2", "thr_c2"), { kind: "crew", coordinatorId: ID, crewId: "c2" });
  assert.deepEqual(store.crew(ID, crewIdSchema.parse("c2"))?.launch, { kind: "started", threadId: "thr_c2" });
});

test("a crew closes once: a second close keeps the first", () => {
  const store = storeWithTicket();
  const id = store.insertCrew(crewInput("crew-1"));
  store.closeCrew(ID, id, "stopped", 3_000);
  store.closeCrew(ID, id, "archived", 4_000);
  assert.deepEqual(store.crew(ID, id)?.closed, { kind: "stopped", at: 3_000 });
});

test("a fix round claimed before its findings are sent survives the plugin's reload, and settles once, with the event that says it was sent back", () => {
  const { storage } = memoryStorage();
  const store = openStore(storage);
  store.insertCoordinator({ id: ID, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
  store.bindTicket("ticket-1", "thr_coordinator");
  const crewId = store.insertCrew(crewInput("crew-1"));
  store.bindTicket("crew-1", "thr_c1");
  assert.equal(store.crew(ID, crewId)?.fixRounds, 0);

  const handoffId = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e");
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: "a".repeat(40), prUrl: null };
  store.insertHandoff({ id: handoffId, coordinatorId: ID, crewId, at: 3_000, turnSeq: 1, status: "done", ...report });
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: ID, crewId, handoffId }, 3_000);
  store.bindTicket("verifier-1", "thr_verifier");
  const failed: Parameters<typeof store.receiveVerdict>[1] = {
    state: "returned",
    verifierThreadId: "thr_verifier",
    headSha: "a".repeat(40),
    criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }],
    findings: [],
    model: { providerId: "codex", model: "gpt-default" },
    sameModel: false,
  };
  assert.ok(store.receiveVerdict(handoffId, failed));
  assert.deepEqual(store.unannounced(ID), [], "nobody is told of a verdict before it is settled");
  store.claimFixRound(handoffId);

  const reloaded = openStore(storage);
  assert.equal(reloaded.crew(ID, crewId)?.fixRounds, 1);
  assert.deepEqual(reloaded.unsettledVerdicts(), [handoffId]);
  assert.equal(reloaded.settleReturned(handoffId, { kind: "sent-back" }, 4_000), ID);
  assert.equal(reloaded.settleReturned(handoffId, { kind: "sent-back" }, 4_000), null, "settled once");
  assert.deepEqual(reloaded.unsettledVerdicts(), []);
  assert.equal(reloaded.crew(ID, crewId)?.fixRounds, 1);
  assert.deepEqual(
    reloaded.unannounced(ID).map(({ event }) => event),
    [{ kind: "sent-back", crewId, handoffId, round: 1 }],
  );
});
