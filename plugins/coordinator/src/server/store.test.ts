import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorIdSchema } from "../model/role.ts";
import { memoryStorage } from "./memory-storage.ts";
import { openStore } from "./store.ts";

const ID = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");

function storeWithTicket() {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: ID, ticket: "ticket-1", projectId: "prj_1", createdAt: 1_000 });
  return store;
}

test("a ticket binds once: a second bind, to the same or another thread, changes nothing", () => {
  const store = storeWithTicket();

  assert.equal(store.bindTicket("ticket-1", "thr_a"), true);
  assert.equal(store.bindTicket("ticket-1", "thr_a"), false);
  assert.equal(store.bindTicket("ticket-1", "thr_b"), false);
  assert.deepEqual(store.roleOfThread("thr_a"), { kind: "coordinator", coordinatorId: ID });
  assert.equal(store.roleOfThread("thr_b"), null);
});

test("an unbound coordinator is not listed until its thread is bound", () => {
  const store = storeWithTicket();
  assert.deepEqual(store.coordinators(), []);

  store.bindTicket("ticket-1", "thr_a");
  assert.deepEqual(store.coordinators(), [{ id: ID, threadId: "thr_a", projectId: "prj_1", createdAt: 1_000 }]);
});

test("an unbound ticket configures only while unbound", () => {
  const store = storeWithTicket();
  assert.equal(store.roleFor("thr_a", "ticket-1")?.kind, "coordinator");
  assert.equal(store.roleFor("thr_a", "invented"), null);

  store.bindTicket("ticket-1", "thr_a");
  assert.equal(store.roleFor("thr_b", "ticket-1"), null);
  assert.equal(store.roleFor("thr_a", null)?.kind, "coordinator");
});
