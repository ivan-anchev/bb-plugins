import assert from "node:assert/strict";
import { test } from "node:test";
import { composerSeed } from "./composer-seed.ts";

const sidebar = { status: "ready" as const, projects: [{ id: "personal", isPersonal: true }, { id: "webhooks", isPersonal: false }] };
const worktreeOn = (hostId: string) => ({ type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });

test("seeds the first of the user's projects in a fresh worktree on the machine running bb", () => {
  assert.deepEqual(composerSeed(null, sidebar, { hostId: "host_1" }), { defaultProjectId: "webhooks", defaultEnvironment: worktreeOn("host_1") });
});

test("the project in view wins", () => {
  assert.equal(composerSeed("in-view", sidebar, { hostId: "host_1" })?.defaultProjectId, "in-view");
});

test("with no machine joined yet, the composer picks its own", () => {
  assert.deepEqual(composerSeed(null, sidebar, { hostId: null }), { defaultProjectId: "webhooks", defaultEnvironment: undefined });
});

test("a failed host read seeds nothing, and a retry that succeeds seeds the worktree", () => {
  assert.equal(composerSeed(null, sidebar, undefined), null);
  assert.deepEqual(composerSeed(null, sidebar, { hostId: "host_1" })?.defaultEnvironment, worktreeOn("host_1"));
});

test("a failed or loading read of bb's projects seeds nothing", () => {
  assert.equal(composerSeed(null, { ...sidebar, status: "error" }, { hostId: "host_1" }), null);
  assert.equal(composerSeed(null, { ...sidebar, status: "loading" }, { hostId: "host_1" }), null);
});
