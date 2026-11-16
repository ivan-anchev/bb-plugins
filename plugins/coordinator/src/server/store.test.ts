import assert from "node:assert/strict";
import { test } from "node:test";
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

const crewInput = (ticket: string) => ({ coordinatorId: ID, ticket, title: "Retries", brief: "Retry deliveries.", doneCriteria: ["npm test passes"], placement: { kind: "worktree" } as const, createdAt: 2_000 });

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
