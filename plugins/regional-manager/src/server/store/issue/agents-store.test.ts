import assert from "node:assert/strict";
import { test } from "node:test";
import { executionOf } from "../../../model/execution.ts";
import { handoffIdSchema } from "../../../model/handoff.ts";
import { EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../test-store.ts";

test("agents are numbered a1, a2… within their regional manager, across issues, and an agent's start puts its issue in Todo", () => {
  const { store } = freshStore();
  const first = filedIssue(store, MANAGER, newIssue({ rest: "backlog" }), 2_000);
  const second = filedIssue(store, MANAGER, newIssue(), 2_000);
  const elsewhere = filedIssue(store, OTHER_MANAGER, newIssue(), 2_000);

  assert.deepEqual([startAgent(store, first.id, "agent-1"), startAgent(store, second.id, "agent-2"), startAgent(store, elsewhere.id, "agent-3", OTHER_MANAGER)], ["a1", "a2", "a1"]);
  assert.equal(store.issue(MANAGER, first.id)?.rest, "todo");
  assert.deepEqual(store.agent(MANAGER, store.agents(MANAGER)[0]!.id), {
    id: "a1",
    coordinatorId: MANAGER,
    issueId: first.id,
    placement: { kind: "worktree" },
    base: { kind: "default" },
    execution: EXECUTION,
    threadId: "thr_agent-1",
    checkout: { environmentId: null, branch: null, head: null },
    fixRounds: 0,
    startedAt: 2_000,
    ended: null,
  });
  assert.deepEqual(store.roleOfThread("thr_agent-2"), { kind: "agent", coordinatorId: MANAGER, agentId: "a2" });
});

test("an agent's thread is null until its ticket binds", () => {
  const { store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agentId = store.insertAgent({ coordinatorId: MANAGER, issueId: id, ticket: "agent-1", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution: EXECUTION, at: 2_000 });
  assert.equal(agentId, "a1");
  assert.equal(store.agents(MANAGER)[0]?.threadId, null);
  assert.equal(store.roleFor("thr_new", "agent-1")?.kind, "agent");
});

test("an ended agent's ticket never binds: a thread bb makes for it late gets no role, and the agent no thread", () => {
  const { store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agent = { coordinatorId: MANAGER, id: store.insertAgent({ coordinatorId: MANAGER, issueId: id, ticket: "agent-1", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution: EXECUTION, at: 2_000 }) ?? assert.fail("no agent"), issueId: id };
  store.endAgent(agent, "replaced", null, true, 3_000);
  assert.equal(store.bindTicket("agent-1", "thr_late"), null);
  assert.deepEqual([store.roleOfThread("thr_late"), store.agent(MANAGER, agent.id)?.threadId], [null, null]);
});

test("an issue has one agent at a time: a second start is refused until the first ends, and ids are never reused", () => {
  const { store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const first = startAgent(store, id, "agent-1");
  assert.equal(store.insertAgent({ coordinatorId: MANAGER, issueId: id, ticket: "agent-2", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution: EXECUTION, at: 2_100 }), null);
  assert.equal(store.roleFor("thr_x", "agent-2"), null, "a refused start mints no ticket");

  store.endAgent({ coordinatorId: MANAGER, id: first, issueId: id }, "stopped", null, false, 3_000);
  assert.equal(startAgent(store, id, "agent-2"), "a2");
});

test("an agent id is never reused: one started after a gap is numbered after the highest", () => {
  const { db, store } = freshStore();
  const [one, two, three] = [1, 2, 3].map(() => filedIssue(store, MANAGER, newIssue(), 2_000).id);
  startAgent(store, one!, "agent-1");
  startAgent(store, two!, "agent-2");
  // why a raw delete: the store never deletes an agent, but whatever does must not free its id.
  db.prepare("DELETE FROM agents WHERE id = 'a1'").run();
  assert.equal(startAgent(store, three!, "agent-3"), "a3");
});

test("the database itself refuses a second agent holding an issue, and takes one once the first ended", () => {
  const { db, store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const first = startAgent(store, id, "agent-1");
  // why raw SQL: insertAgent refuses before it writes, so only a write past it reaches the index.
  db.prepare("INSERT INTO roles (ticket, role, created_at) VALUES ('agent-2', '{}', 2100)").run();
  const second = db.prepare(
    `INSERT INTO agents (coordinator_id, id, issue_id, ticket, placement, base, execution, started_at)
     SELECT coordinator_id, 'a2', issue_id, 'agent-2', placement, base, execution, 2100 FROM agents WHERE id = ?`,
  );
  assert.throws(() => second.run(first), /UNIQUE constraint failed: agents\.coordinator_id, agents\.issue_id/);

  store.endAgent({ coordinatorId: MANAGER, id: first, issueId: id }, "stopped", null, false, 3_000);
  second.run(first);
  assert.deepEqual(store.agents(MANAGER).map(({ id }) => id), ["a1", "a2"]);
});

test("an agent's start that fails partway leaves no agent, no ticket, and its issue where it was", () => {
  const { db, store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue({ rest: "backlog" }), 2_000);
  failWrites(db, "UPDATE", "issues");
  assert.throws(() => startAgent(store, id, "agent-1"), /forced failure/);
  assert.deepEqual(store.agents(MANAGER), []);
  assert.equal(store.roleFor("thr_x", "agent-1"), null);
  assert.equal(store.issue(MANAGER, id)?.rest, "backlog");
});

test("an agent ends once, and the manager is told its issue returned to Todo only when nothing it left places it", () => {
  const { store } = freshStore();
  const left = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e");
  const issues = [1, 2, 3].map(() => filedIssue(store, MANAGER, newIssue(), 2_000));
  const [returned, placed, neverStarted] = issues.map(({ id }, n) => ({ coordinatorId: MANAGER, id: startAgent(store, id, `agent-${n}`), issueId: id }));

  assert.equal(store.endAgent(returned!, "archived", null, false, 3_000), true);
  assert.equal(store.endAgent(returned!, "deleted", null, false, 3_100), false, "a second end changes nothing");
  assert.equal(store.endAgent(placed!, "stopped", left, true, 3_000), true);
  assert.equal(store.endAgent(neverStarted!, "spawn-failed", null, false, 3_000), true);

  assert.deepEqual(store.agent(MANAGER, returned!.id)?.ended, { how: "archived", at: 3_000, left: null });
  assert.deepEqual(store.agent(MANAGER, placed!.id)?.ended, { how: "stopped", at: 3_000, left });
  assert.deepEqual(
    store.unannounced(MANAGER).map(({ event }) => event),
    [{ kind: "returned-to-todo", issueId: returned!.issueId, agentId: returned!.id, how: "archived" }],
  );
});

test("an agent's end that fails before the manager is told leaves the agent holding its issue", () => {
  const { db, store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agent = { coordinatorId: MANAGER, id: startAgent(store, id, "agent-1"), issueId: id };
  failWrites(db, "INSERT", "events");
  assert.throws(() => store.endAgent(agent, "archived", null, false, 3_000), /forced failure/);
  assert.equal(store.agent(MANAGER, agent.id)?.ended, null);
});

test("where an agent's work was last seen, and what it ran on, are recorded as it hands off", () => {
  const { store } = freshStore();
  const { id } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agentId = startAgent(store, id, "agent-1");
  const checkout = { environmentId: "env_1", branch: "bb/retries", head: "a".repeat(40) };
  const switched = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
  store.recordCheckout(MANAGER, agentId, checkout);
  store.recordExecution(MANAGER, agentId, switched);
  const agent = store.agent(MANAGER, agentId);
  assert.deepEqual([agent?.checkout, agent?.execution], [checkout, switched]);
  assert.equal(store.agentTicket(MANAGER, agentId), "agent-1");
});

test("an execution resolved to a catalog's empty default reasoning level is stored and read back as bb gave it", () => {
  const { store } = freshStore();
  const execution = executionOf({ providerId: "codex", model: "gpt-5.4" }, { providers: [{ id: "codex", available: true }], models: [{ model: "gpt-5.4", isDefault: true, defaultReasoningEffort: "" }] });
  if ("refused" in execution) assert.fail(execution.refused);
  const issue = filedIssue(store, MANAGER, newIssue({ verifier: execution }), 2_000);
  const agentId = store.insertAgent({ coordinatorId: MANAGER, issueId: issue.id, ticket: "agent-1", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution, at: 2_000 }) ?? assert.fail("the issue already had an agent");

  const stored = { providerId: "codex", model: "gpt-5.4", reasoningLevel: "" };
  assert.deepEqual([store.issue(MANAGER, issue.id)?.verifier, store.agent(MANAGER, agentId)?.execution], [stored, stored]);
});
