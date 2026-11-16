import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffIdSchema, type HandoffId } from "../model/handoff.ts";
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
  store.insertHandoff({ id: handoffId, coordinatorId: ID, crewId, at: 3_000, turnSeq: 1, status: "done", ...report }, { kind: "read", checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 } });
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
  store.claimFixRound(handoffId, { kind: "none" });

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

test("a provider placement stored in an earlier shape reads as the environment it spawned in", () => {
  const { db, storage } = memoryStorage();
  // As the store stood before provider placements were stored as environments.
  const before = openStore({ ...storage, migrate: (handle, statements) => storage.migrate(handle, statements.slice(0, statements.findIndex((statement) => statement.startsWith("UPDATE crews SET placement")))) });
  before.insertCoordinator({ id: ID, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
  const insert = db.prepare("INSERT INTO crews (coordinator_id, id, title, brief, done_criteria, placement, created_at) VALUES (?, ?, 'Retries', 'Retry deliveries.', '[\"npm test passes\"]', ?, ?)");
  insert.run(ID, "c1", JSON.stringify({ kind: "provider", environmentProviderId: "personal-workspace" }), 2_000);
  insert.run(ID, "c2", JSON.stringify({ kind: "provider", environmentProviderId: "boat-sandbox", inputs: {}, machine: { machineProviderId: "boat-sandbox", inputs: { preset: "small" } } }), 2_001);
  insert.run(ID, "c3", JSON.stringify({ kind: "worktree" }), 2_002);

  assert.deepEqual(
    openStore(storage)
      .crews(ID)
      .map((crew) => crew.placement),
    [
      { kind: "chosen", environment: { type: "provider", environmentProviderId: "personal-workspace", inputs: null } },
      { kind: "chosen", environment: { type: "provider", environmentProviderId: "boat-sandbox", inputs: {}, machine: { type: "new", machineProviderId: "boat-sandbox", inputs: { preset: "small" } } } },
      { kind: "worktree" },
    ],
  );
});

/** The migrations as they stood before verdicts kept the crew's checkout, and as the release that first read it left them. */
const beforeCheckouts = (statements: string[]) => statements.slice(0, statements.findIndex((statement) => statement.includes("'$.checkout'")));
const throughFirstRead = (statements: string[]) => statements.slice(0, beforeCheckouts(statements).length + 1);

const UPGRADED =
  "the plugin was upgraded while this handoff waited for its verdict, and nothing shows whether its commit and working tree were checked; a new handoff gets verified";

const claimed = "a".repeat(40);
const report = { status: "done" as const, summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: claimed, prUrl: null };
const dirty = { headSha: claimed, changedFiles: ["?? notes.txt"], changedFileCount: 1 };

function doneVerdict(store: ReturnType<typeof openStore>, id: HandoffId) {
  const handoff = store.handoff(id);
  return handoff?.status === "done" ? handoff.verdict : assert.fail(`no done handoff ${id}`);
}

for (const via of ["straight", "through the release that first read checkouts"] as const) {
  test(`upgraded ${via}, a verdict queued or running at the upgrade is couldn't verify, its coordinating thread told and no fix round spent; a returned one is left as it was`, () => {
    const { db, storage } = memoryStorage();
    const before = openStore({ ...storage, migrate: (handle, statements) => storage.migrate(handle, beforeCheckouts(statements)) });
    before.insertCoordinator({ id: ID, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
    const crewId = before.insertCrew(crewInput("crew-1"));
    const returned = { state: "returned", verifierThreadId: "thr_v", headSha: claimed, criteria: [{ criterion: "npm test passes", result: "pass", evidence: "# fail 0" }], findings: [], model: { providerId: "codex", model: "gpt-default" }, sameModel: false };
    const [queued, running, judged] = ["0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d51", "0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d52", "0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d53"].map((id) => handoffIdSchema.parse(id));
    [{ state: "queued" }, { state: "running", verifierThreadId: "thr_v", nudged: false }, returned].forEach((verdict, i) => {
      db.prepare("INSERT INTO handoffs (id, coordinator_id, crew_id, report, turn_seq, at) VALUES (?, ?, ?, ?, ?, ?)").run([queued, running, judged][i], ID, crewId, JSON.stringify(report), i + 1, 2_000 + i);
      db.prepare("INSERT INTO verdicts (handoff_id, verdict) VALUES (?, ?)").run([queued, running, judged][i], JSON.stringify(verdict));
    });
    // A handoff that release stored with the checkout bb's git plugin read, still queued: nothing tells it from a made-up one.
    const read = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d54");
    const otherCrew = crewIdSchema.parse("c2");
    if (via !== "straight") {
      const released = openStore({ ...storage, migrate: (handle, statements) => storage.migrate(handle, throughFirstRead(statements)) });
      assert.equal(released.insertCrew(crewInput("crew-2")), otherCrew);
      released.insertHandoff({ id: read, coordinatorId: ID, crewId: otherCrew, at: Date.now(), turnSeq: 1, ...report }, { kind: "read", checkout: dirty });
    }

    const store = openStore(storage);
    const open = via === "straight" ? [queued, running] : [queued, running, read];
    for (const id of open) assert.deepEqual(doneVerdict(store, id), { state: "could-not-run", verifierThreadId: null, reason: UPGRADED });
    assert.deepEqual(
      store.unannounced(ID).map(({ event }) => event),
      [
        { kind: "checked", crewId, handoffId: queued },
        { kind: "checked", crewId, handoffId: running },
        ...(via === "straight" ? [] : [{ kind: "checked", crewId: otherCrew, handoffId: read }]),
      ],
      "its regional manager is told of each",
    );
    assert.deepEqual(
      store.crews(ID).map((crew) => crew.fixRounds),
      via === "straight" ? [0] : [0, 0],
      "no fix round is spent",
    );
    const kept = doneVerdict(store, judged);
    assert.ok(kept.state === "returned");
    assert.deepEqual(kept.checkout, { headSha: claimed, changedFiles: [], changedFileCount: 0 }, "a returned verdict keeps the checkout the release gave it");
  });
}

for (const install of ["a fresh install", "an upgraded one"] as const) {
  test(`on ${install}, a checkout bb's git plugin reads after the upgrade is kept, across a reload`, () => {
    const { storage } = memoryStorage();
    if (install === "an upgraded one") openStore({ ...storage, migrate: (handle, statements) => storage.migrate(handle, beforeCheckouts(statements)) });
    const store = openStore(storage);
    store.insertCoordinator({ id: ID, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
    const crewId = store.insertCrew(crewInput("crew-1"));
    const id = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d55");
    store.insertHandoff({ id, coordinatorId: ID, crewId, at: 3_000, turnSeq: 1, ...report }, { kind: "read", checkout: dirty });

    const reloaded = openStore(storage);
    assert.deepEqual(doneVerdict(reloaded, id), { state: "queued", checkout: dirty });
    assert.deepEqual(reloaded.unannounced(ID), [], "nothing to tell");
  });
}
