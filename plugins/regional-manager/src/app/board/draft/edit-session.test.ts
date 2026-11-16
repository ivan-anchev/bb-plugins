import assert from "node:assert/strict";
import { test } from "node:test";
import type { Draft } from "../../../contract.ts";
import { coordinatorIdSchema, crewIdSchema } from "../../../model/role.ts";
import { typed } from "./criteria.ts";
import { readStored, writeStored } from "../../ui/stored.ts";
import { composerKeyOf, editSessionSchema, newerOf, opened, storageKeyOf, type EditSession } from "./edit-session.ts";

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const C1 = crewIdSchema.parse("c1");

const DRAFT: Draft = {
  projectId: "proj_1",
  brief: "Retry failed webhook deliveries with backoff.",
  doneCriteria: ["npm test passes", "a failed delivery is retried 3 times"],
  execution: { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium", permissionMode: "auto", executionInputSources: { providerId: "explicit", model: "explicit" } },
  environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
};

const KEY = storageKeyOf(COORDINATOR, C1);

/** What a reload finds when the browser holds `raw` under the edit's key. */
const found = (raw: string | null): EditSession | null => readStored({ getItem: () => raw }, KEY, editSessionSchema);

/** What a reload finds after the edit was stored. */
function reloaded(session: EditSession): EditSession | null {
  let raw: string | null = null;
  writeStored({ setItem: (_, value) => (raw = value), removeItem: () => (raw = null) }, KEY, session);
  return found(raw);
}

test("an edit opens on the draft as read, with its criteria and nothing newer", () => {
  const session = opened(DRAFT, 1000);
  assert.deepEqual(
    session.criteria.map((field) => field.text),
    DRAFT.doneCriteria,
  );
  assert.equal(newerOf(session, DRAFT), null);
});

test("an edit survives a reload whole, under the same composer key, so the brief, model and environment come back too", () => {
  const session = opened(DRAFT, 1000);
  const edited = { ...session, criteria: typed(session.criteria, 1, "a failed delivery is retried 3 times,\nthen dead-lettered") };

  const after = reloaded(edited);
  assert.deepEqual(after, edited);
  assert.ok(after !== null);
  assert.equal(composerKeyOf(COORDINATOR, C1, after), composerKeyOf(COORDINATOR, C1, edited));
});

test("each opening gets its own composer key, so Edit after Cancel starts from what is stored", () => {
  assert.notEqual(composerKeyOf(COORDINATOR, C1, opened(DRAFT, 1000)), composerKeyOf(COORDINATOR, C1, opened(DRAFT, 2000)));
});

test("nothing stored, or something that isn't an edit, reads as no edit", () => {
  assert.equal(found(null), null);
  assert.equal(found("{not json"), null);
  assert.equal(found(JSON.stringify({ openedAt: 1000, criteria: [] })), null);
});

test("the user's own changes are not a newer draft", () => {
  const session = opened(DRAFT, 1000);
  const edited = { ...session, criteria: typed(session.criteria, 0, "npm test passes on Node 22") };
  assert.equal(newerOf(edited, DRAFT), null);
});

test("a draft saved elsewhere during the edit is shown beside it, naming each part that changed", () => {
  const session = opened(DRAFT, 1000);

  assert.deepEqual(newerOf(session, { ...DRAFT, brief: "Retry with jitter." })?.changed, ["brief"]);
  assert.deepEqual(newerOf(session, { ...DRAFT, doneCriteria: ["npm test passes"] })?.changed, ["done-criteria"]);
  assert.deepEqual(newerOf(session, { ...DRAFT, execution: null })?.changed, ["model"]);
  assert.deepEqual(newerOf(session, { ...DRAFT, environment: { type: "reuse", environmentId: "env_9" } })?.changed, ["environment"]);

  const saved: Draft = { ...DRAFT, brief: "Retry with jitter.", doneCriteria: ["npm test passes"] };
  assert.deepEqual(newerOf(session, saved), { draft: saved, changed: ["brief", "done-criteria"] });
});

test("the newer draft stays newer after a reload, so the user still sees both", () => {
  const session = opened(DRAFT, 1000);
  const saved: Draft = { ...DRAFT, brief: "Retry with jitter." };
  const after = reloaded(session);
  assert.ok(after !== null);
  assert.deepEqual(newerOf(after, saved)?.changed, ["brief"]);
  assert.equal(newerOf(after, DRAFT), null, "the draft as read before the reload is not newer");
});

test("taking the saved version opens a fresh edit of it, under a new composer key", () => {
  const session = opened(DRAFT, 1000);
  const saved: Draft = { ...DRAFT, brief: "Retry with jitter.", doneCriteria: ["npm test passes"] };
  const fresh = opened(saved, 2000);

  assert.equal(newerOf(fresh, saved), null);
  assert.deepEqual(
    fresh.criteria.map((field) => field.text),
    ["npm test passes"],
  );
  assert.notEqual(composerKeyOf(COORDINATOR, C1, fresh), composerKeyOf(COORDINATOR, C1, session));
});
