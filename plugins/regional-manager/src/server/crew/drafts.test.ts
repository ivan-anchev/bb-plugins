import assert from "node:assert/strict";
import { test } from "node:test";
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { coordinatorContract } from "../../contract.ts";
import { crewIdSchema } from "../../model/role.ts";
import { coordinating, newThreadRequest, textOf } from "../test-harness.ts";

const C1 = crewIdSchema.parse("c1");
const RETRIES = { title: "Add retries", brief: "Retry failed webhook deliveries with backoff.", doneCriteria: ["npm test passes", "a failed delivery is retried 3 times"] };

async function drafted() {
  const kit = await coordinating();
  const text = textOf(await kit.kit.call("crew_start", { ...RETRIES, draft: true }, kit.threadId));
  return { ...kit, text };
}

/** What the draft editor submits: bb's composer request with this brief, on Sonnet in an existing worktree. */
const edited = (brief: string): NewThreadRequest => ({
  ...newThreadRequest(brief),
  model: "sonnet",
  // why unmarked: bb's composer marks a field only once the user touches it, as here the model.
  reasoningLevel: "low",
  executionInputSources: { model: "explicit" },
  environment: { type: "reuse", environmentId: "env_9" },
});

const isConflict = (error: unknown): boolean => error instanceof Refusal && error.code === "conflict";

test("crew_start with draft: true starts no thread and says the draft waits for the user", async () => {
  const { kit, text } = await drafted();
  assert.match(text, /^Saved c1 as a draft\. It waits for the user under Needs you on the board/);
  assert.equal(kit.spawned(), 1, "only the regional manager was spawned");
});

test("a draft sits under Needs you headed with its title, with what its editor starts from", async () => {
  const { kit, coordinatorId } = await drafted();
  const [row] = (await kit.rpc.board({ coordinatorId })).rows;
  assert.deepEqual(row, {
    crewId: "c1",
    title: "Add retries",
    threadId: null,
    branch: null,
    state: "needs-you",
    headline: "Draft: Add retries",
    verdict: null,
    pr: null,
    draft: {
      projectId: "prj_1",
      brief: RETRIES.brief,
      doneCriteria: RETRIES.doneCriteria,
      execution: null,
      // The worktree it would get: on the coordinating thread's machine.
      environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
    },
  });
});

test("crew_catch_up lists the draft as waiting for the user", async () => {
  const { kit, threadId } = await drafted();
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### Needs you \(1\)\n- c1 "Add retries", a draft with no thread: it waits for the user to start it/);
});

test("an edited draft starts with the edited brief and criterion, on the model and in the environment picked", async () => {
  const { kit, coordinatorId } = await drafted();
  await kit.rpc.updateDraft({ coordinatorId, crewId: C1, request: edited("Retry with jittered backoff, at most 5 times."), doneCriteria: ["npm test passes", "a failed delivery is retried 5 times"] });

  const { threadId } = await kit.rpc.startDraft({ coordinatorId, crewId: C1 });
  const { spawnedWith, providerId, execution } = kit.thread(threadId);
  const prompt = spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /## Brief\n\nRetry with jittered backoff, at most 5 times\./);
  assert.match(prompt, /1\. npm test passes\n2\. a failed delivery is retried 5 times/);
  assert.doesNotMatch(prompt, /retried 3 times/);
  assert.deepEqual([providerId, execution], ["claude-code", { model: "sonnet", reasoningLevel: "low", serviceTier: "default", permissionMode: "auto" }]);
  assert.deepEqual(spawnedWith.environment, { type: "reuse", environmentId: "env_9" });
  assert.equal(kit.store.roleOfThread(threadId)?.kind, "crew");
  assert.deepEqual((await kit.rpc.board({ coordinatorId })).rows.map((row) => [row.state, row.threadId, row.draft]), [["working", threadId, null]]);
});

test("two fast Starts on one draft spawn one thread", async () => {
  const { kit, coordinatorId } = await drafted();
  const [first, second] = await Promise.all([kit.rpc.startDraft({ coordinatorId, crewId: C1 }), kit.rpc.startDraft({ coordinatorId, crewId: C1 })]);
  assert.equal(first.threadId, second.threadId);
  assert.equal(kit.spawned(), 2, "the regional manager and one crew");
});

test("Start on a crew that already started is refused and spawns nothing", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await kit.call("crew_start", RETRIES, threadId);
  await assert.rejects(async () => kit.rpc.startDraft({ coordinatorId, crewId: C1 }), (error: unknown) => isConflict(error) && /c1 has already started/.test(String(error)));
  assert.equal(kit.spawned(), 2);
});

test("a closed draft can be neither started nor edited", async () => {
  const { kit, threadId, coordinatorId } = await drafted();
  await kit.call("crew_close", { crewId: "c1", action: "resolve" }, threadId);
  await assert.rejects(async () => kit.rpc.startDraft({ coordinatorId, crewId: C1 }), isConflict);
  assert.throws(() => kit.rpc.updateDraft({ coordinatorId, crewId: C1, request: edited("New brief"), doneCriteria: ["npm test passes"] }), isConflict);
  assert.equal(kit.spawned(), 1);
});

test("an edit is refused while the draft starts, and once it has", async () => {
  const { kit, coordinatorId } = await drafted();
  const starting = kit.rpc.startDraft({ coordinatorId, crewId: C1 });
  const edit = () => kit.rpc.updateDraft({ coordinatorId, crewId: C1, request: edited("Too late"), doneCriteria: ["npm test passes"] });
  assert.throws(edit, (error) => isConflict(error) && /c1 is starting/.test(String(error)));
  const { threadId } = await starting;
  assert.throws(edit, isConflict);
  assert.match(kit.thread(threadId).spawnedWith.prompt ?? "", /Retry failed webhook deliveries with backoff\./);
});

test("an edit with an attachment, an empty brief or another project is refused, and the draft keeps its brief", async () => {
  const { kit, coordinatorId } = await drafted();
  const image = { type: "image", url: "https://example.com/a.png" } as const;
  for (const request of [{ ...edited("New brief"), input: [...edited("New brief").input, image] }, edited("   "), { ...edited("New brief"), projectId: "prj_2" }]) {
    assert.throws(() => kit.rpc.updateDraft({ coordinatorId, crewId: C1, request, doneCriteria: ["npm test passes"] }), (error) => error instanceof Refusal && error.code === "invalid");
  }
  assert.equal(kit.store.crew(coordinatorId, C1)?.brief, RETRIES.brief);
});

test("an edit with no environment is refused before it reaches the plugin, and the draft still reads", async () => {
  const { kit, coordinatorId } = await drafted();
  const { environment: _, ...request } = edited("New brief");
  // As bb delivers an RPC: the contract parses the input, and only a parsed input reaches the handler.
  const deliver = () => kit.rpc.updateDraft(coordinatorContract.updateDraft.input.parse({ coordinatorId, crewId: C1, request, doneCriteria: ["npm test passes"] }));
  assert.throws(deliver, /Expected an environment from bb's composer/);
  assert.equal(kit.store.crew(coordinatorId, C1)?.brief, RETRIES.brief);
  assert.equal((await kit.rpc.board({ coordinatorId })).rows[0]?.draft?.brief, RETRIES.brief);
});

test("a crew whose spawn failed is a draft that starts on the next Start", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  Object.assign(kit.spawns, { created: false, answer: "lost" });
  await kit.call("crew_start", RETRIES, threadId);
  await assert.rejects(async () => kit.rpc.startDraft({ coordinatorId, crewId: C1 }), /bb did not start its thread: socket hang up/);

  Object.assign(kit.spawns, { created: true, answer: "thread" });
  const started = await kit.rpc.startDraft({ coordinatorId, crewId: C1 });
  assert.match(textOf(await kit.call("crew_read", { crewId: "c1" }, threadId)), new RegExp(`Thread: @thread:${started.threadId}`));
});
