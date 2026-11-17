import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { coordinating, settled, startedAgent, textOf } from "../test-harness.ts";

const DONE = {
  status: "done",
  summary: "Retries land with backoff",
  did: ["Added exponential backoff"],
  evidence: ["npm test: 12 passing"],
  concerns: [],
  deviations: [],
  findings: [],
  headSha: "0123456789abcdef0123456789abcdef01234567",
};

async function withCrew() {
  const { kit, threadId, coordinatorId } = await coordinating();
  const crewThreadId = (await startedAgent(kit, threadId, { title: "Add retries", brief: "Retry deliveries." })).agentThreadId;
  kit.thread(threadId).status = "idle";
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  const row = async () => {
    const issue = (await kit.rpc.board({ coordinatorId })).issues[0];
    return issue === undefined ? undefined : { ...issue, lane: laneOf(issue) };
  };
  return { kit, threadId, coordinatorId, crewThreadId, doorbells, row };
}

test("an agent that goes idle without a handoff is announced, its last answer only in crew_catch_up", async () => {
  const { kit, threadId, crewThreadId, doorbells, row } = await withCrew();
  await kit.idle(crewThreadId, "I stopped halfway: the staging key is missing.");
  await settled();

  assert.deepEqual(doorbells().map((text) => text.split("\n")[1]), [`- i1 "Add retries" (a1) ended its turn without a handoff`]);
  assert.doesNotMatch(doorbells().join("\n"), /staging key/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### i1 "Add retries" \(a1\) ended its turn without a handoff\n\nAt [^\n]+ Its last answer, in its own words:\n\nI stopped halfway: the staging key is missing\./);
  assert.deepEqual([(await row())?.lane, (await row())?.headline], ["in-progress", "Its turn ended without a handoff"]);
});

test("an agent whose turn ends after its handoff is not announced as stopping without one", async () => {
  const { kit, coordinatorId, crewThreadId, doorbells } = await withCrew();
  await kit.call("agent_handoff", { ...DONE, status: "blocked" }, crewThreadId);
  await kit.idle(crewThreadId, "Handed off.");
  await settled();

  assert.equal(doorbells().length, 1);
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);
  assert.match(doorbells()[0] ?? "", /handed off: blocked/);
});

test("after a handoff, typing into the agent moves its issue out of Verifying, and its end with no new handoff is announced", async () => {
  const { kit, crewThreadId, doorbells, row } = await withCrew();
  await kit.call("agent_handoff", DONE, crewThreadId);
  await kit.idle(crewThreadId, "Handed off.");
  assert.equal((await row())?.lane, "verifying");

  kit.startTurn(crewThreadId); // the user types into the crew's thread
  assert.equal((await row())?.lane, "in-progress");

  await kit.idle(crewThreadId, "Answered the user's question.");
  await settled();
  assert.deepEqual([(await row())?.lane, (await row())?.headline], ["in-progress", "Its turn ended without a handoff"]);
  assert.match(doorbells().at(-1) ?? "", /i1 "Add retries" \(a1\) ended its turn without a handoff/);
});

test("a failed agent is announced, with bb's error in crew_catch_up", async () => {
  const { kit, threadId, crewThreadId, doorbells } = await withCrew();
  kit.thread(crewThreadId).status = "error";
  await kit.emit("thread.failed", { thread: kit.ref(crewThreadId), error: "Provider rate limit reached" });
  await settled();

  assert.match(doorbells()[0] ?? "", /\n- i1 "Add retries" \(a1\) failed$/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### i1 "Add retries" \(a1\) failed\n\nAt [^\n]+ bb's error:\n\nProvider rate limit reached Read the issue with issue_read/);
});

test("an agent's approval prompt is announced as waiting on the user, with what it asks in crew_catch_up", async () => {
  const { kit, threadId, crewThreadId, doorbells } = await withCrew();
  await kit.emit("interaction.pending", {
    thread: kit.ref(crewThreadId),
    interaction: {
      payload: {
        kind: "approval",
        availableDecisions: ["allow_once", "deny"],
        reason: "It deletes the build cache",
        subject: { kind: "command", command: "rm -rf .cache", cwd: null, itemId: "item_1", actions: [], sessionGrant: null },
      },
    },
  });
  await settled();

  assert.match(doorbells()[0] ?? "", /i1 "Add retries" \(a1\) is waiting on the user in its thread$/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /It asks, in its own words:\n\nAsks to approve the command `rm -rf \.cache`: It deletes the build cache/);
});

test("a plugin's or a provider's question is passed on by its title, and one from a newer bb by a neutral line", async () => {
  const { kit, threadId, crewThreadId } = await withCrew();
  const ask = (payload: PluginThreadEventPayloads["interaction.pending"]["interaction"]["payload"]) => kit.emit("interaction.pending", { thread: kit.ref(crewThreadId), interaction: { payload } });
  await ask({ kind: "plugin", title: "Pick a staging region", data: null });
  await ask({ kind: "codex/mcp-elicitation", title: "Sign in to the issue tracker", data: null });
  // bb's data, as a newer bb may send it: a kind this SDK doesn't know, with fields it doesn't name.
  await ask(JSON.parse(`{ "kind": "survey", "questions": 3 }`));
  await settled();

  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  const asked = [...caughtUp.matchAll(/It asks, in its own words:\n\n([^\n]+)/g)].map((match) => match[1]);
  assert.deepEqual(asked, ["Pick a staging region", "Sign in to the issue tracker", "Asks the user something in its thread"]);
});

test("an archived agent thread ends its agent: its issue returns to Todo, and its regional manager is told", async () => {
  const { kit, coordinatorId, crewThreadId, doorbells, row } = await withCrew();
  kit.thread(crewThreadId).archivedAt = 5_000;
  await kit.emit("thread.archived", { thread: kit.ref(crewThreadId) });
  await settled();

  assert.equal(kit.store.agents(coordinatorId)[0]?.ended?.how, "archived");
  assert.deepEqual([(await row())?.lane, (await row())?.headline, (await row())?.agent?.threadId], ["todo", "Not started", null]);
  assert.deepEqual(doorbells().map((text) => text.split("\n")[1]), [`- i1 "Add retries" (a1) returned to Todo: its agent was archived`]);
});

test("events about other threads, another plugin's or an ended agent's, are ignored", async () => {
  const { kit, threadId, crewThreadId, doorbells } = await withCrew();
  await kit.emit("thread.failed", { thread: { id: crewThreadId, originPluginId: "another-plugin" }, error: null });
  await kit.idle(threadId, "The regional manager's own turn ended.");
  await settled();
  assert.deepEqual(doorbells(), []);

  await kit.call("agent_stop", { agent: "a1" }, threadId);
  await settled();
  const told = doorbells().length;
  await kit.idle(crewThreadId, "Still here.");
  await kit.emit("thread.failed", { thread: kit.ref(crewThreadId), error: null });
  await settled();
  assert.equal(doorbells().length, told, "nothing after its end");
});
