import assert from "node:assert/strict";
import { test } from "node:test";
import { createStart, requestOf, type CreateStart } from "./create-form.ts";

const sidebar = {
  status: "ready" as const,
  projects: [
    { id: "personal", name: "Personal", isPersonal: true },
    { id: "webhooks", name: "Webhooks", isPersonal: false },
    { id: "cron", name: "Cron", isPersonal: false },
  ],
};
const execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
const seed = { hostId: "host_1", execution };

const started = (start: ReturnType<typeof createStart>): CreateStart => (start === null || "missing" in start ? assert.fail(`no start: ${JSON.stringify(start)}`) : start);

test("starts on the first of the user's projects, in a fresh worktree from its default branch, on bb's default provider and model, on auto", () => {
  assert.deepEqual(createStart(null, sidebar, seed), {
    choices: { projectId: "webhooks", place: "worktree", baseBranch: null, execution, permissionMode: "auto" },
    hostId: "host_1",
    projects: [
      { id: "webhooks", name: "Webhooks" },
      { id: "cron", name: "Cron" },
    ],
    personalProjectId: "personal",
  });
});

test("the project in view wins, unless it is the personal one", () => {
  assert.equal(started(createStart("cron", sidebar, seed)).choices.projectId, "cron");
  assert.equal(started(createStart("personal", sidebar, seed)).choices.projectId, "webhooks");
});

test("nothing starts until both reads have succeeded", () => {
  assert.equal(createStart(null, sidebar, undefined), null);
  assert.equal(createStart(null, { ...sidebar, status: "error" }, seed), null);
  assert.equal(createStart(null, { ...sidebar, status: "loading" }, seed), null);
});

test("with no project, or no provider bb can run, it says what is missing", () => {
  assert.deepEqual(createStart(null, { ...sidebar, projects: [sidebar.projects[0]!] }, seed), { missing: "Add a project to bb first: a regional manager works on one." });
  assert.deepEqual(createStart(null, sidebar, { hostId: "host_1", execution: null }), { missing: "bb can run no provider on this machine yet. Set one up in bb's settings." });
});

test("each place asks bb for its environment on the machine running bb, with the execution and permission mode picked", () => {
  const start = started(createStart(null, sidebar, seed));
  const run = { ...execution, serviceTier: "fast", permissionMode: "accept-edits" as const };
  const choices = { ...start.choices, execution: { ...execution, serviceTier: "fast" }, permissionMode: "accept-edits" as const };

  assert.deepEqual(requestOf(choices, start), { ...run, projectId: "webhooks", environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } } });
  assert.deepEqual(requestOf({ ...choices, baseBranch: "release/2" }, start).environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "release/2" } } });
  assert.deepEqual(requestOf({ ...choices, place: "checkout" }, start), { ...run, projectId: "webhooks", environment: { type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: null } } });
  assert.deepEqual(requestOf({ ...choices, place: "personal" }, start), { ...run, projectId: "personal", environment: { type: "host", hostId: "host_1", workspace: { type: "personal" } } });
});

test("with no machine joined yet, bb picks the machine", () => {
  const start = started(createStart(null, sidebar, { hostId: null, execution }));
  assert.deepEqual(requestOf(start.choices, start).environment, { type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
});
