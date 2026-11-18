import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeMessageDispatchHookContext, makeQueueEntry } from "@get-bb/plugin-sdk/testing";
import { DEFAULT_AVATAR } from "../../model/profile.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { openMemoryRoot } from "../memory/memory-files.ts";
import { memoryStorage } from "../memory-storage.ts";
import { openStore } from "../store/store.ts";
import { PLACEHOLDER, watchGoals } from "./goal.ts";

// The goal's message.dispatch hook, as bb calls it in its admission path, over the plugin's real
// store and memory folder and a fake of bb's queue and events.

const PLUGIN_ID = "regional-manager";
const MANAGER = "thr_manager";
const ID = coordinatorIdSchema.parse("8f9e1c2a-0000-4000-8000-000000000001");
const WAIT = { action: "wait", reason: "Waiting for your goal" };
const PROCEED = { action: "proceed" };

type GoalBb = Parameters<typeof watchGoals>[0];
type Hook = Parameters<GoalBb["experimental_hooks"]["on"]>[1];

/** The plugin's goal over a regional manager bound to MANAGER, still waiting for its goal, and the placeholder queued in its thread. */
function setup() {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: ID, ticket: "ticket_1", projectId: "prj_1", verify: true, description: null, avatar: DEFAULT_AVATAR, createdAt: 1 });
  store.bindTicket("ticket_1", MANAGER);
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "goal-")), "data.db"), store, () => {});
  memory.of(ID).seed();
  const warnings: string[] = [];
  const queue: ReturnType<typeof makeQueueEntry>[] = [placeholderRow("qm_placeholder")];
  const requested: { data: unknown }[] = [];
  let hook: Hook | null = null;
  let idle: ((payload: { thread: { id: string } }) => Promise<void>) | null = null;
  const boards: string[] = [];
  const bb: GoalBb = {
    pluginId: PLUGIN_ID,
    log: { warn: (message) => void warnings.push(message) },
    experimental_hooks: { on: (_hook, handler) => void (hook = handler) },
    events: { on: (_event, handler) => void (idle = handler) },
    sdk: {
      threads: {
        // As bb does, each row is a copy, and a delete of a row that is gone fails.
        queuedMessages: {
          list: async ({ threadId }) => queue.filter((row) => row.threadId === threadId).map((row) => structuredClone(row)),
          delete: async ({ queuedMessageId }) => {
            const at = queue.findIndex((row) => row.id === queuedMessageId);
            if (at === -1) throw new Error(`HTTP 404: No queued message ${queuedMessageId}`);
            queue.splice(at, 1);
          },
        },
        events: { list: async () => requested.map((event) => structuredClone(event)) },
      },
    },
  };
  const goals = watchGoals(bb, { store, memory, onChange: (id) => void boards.push(id) });
  const goalFile = join(memory.of(ID).dir, "GOAL.md");
  return {
    store,
    goals,
    queue,
    requested,
    warnings,
    boards,
    dispatch: (overrides: Parameters<typeof makeMessageDispatchHookContext>[0]) => (hook ?? assert.fail("no hook registered"))(makeMessageDispatchHookContext(overrides)),
    idle: (threadId: string) => (idle ?? assert.fail("no thread.idle handler"))({ thread: { id: threadId } }),
    goal: () => (existsSync(goalFile) ? readFileSync(goalFile, "utf8") : null),
  };
}

/** The plugin's placeholder as bb queues it in the manager's thread. */
const placeholderRow = (id: string) => makeQueueEntry({ id, threadId: MANAGER, origin: "plugin", originPluginId: PLUGIN_ID, initiator: "agent", content: [{ type: "text", text: PLACEHOLDER, mentions: [] }] });

/** A message the user typed in `threadId`'s composer, sent now. */
const typed = (threadId: string, text: string) => ({ thread: { id: threadId }, initiator: "user" as const, senderThreadId: null, origin: "app" as const, input: { text, blocks: [{ type: "text" as const, text, mentions: [] }] } });

/** The plugin's doorbell to the manager, sent now. */
const doorbell = (text: string) => ({ thread: { id: MANAGER }, initiator: "user" as const, senderThreadId: null, origin: "plugin" as const, originPluginId: PLUGIN_ID, input: { text, blocks: [{ type: "text" as const, text, mentions: [] }] } });

/** The spawn's own attempt: the placeholder as its first message, sent with `submission`. */
const spawnAttempt = (threadId: string, submission: { pluginId: string; data: null | { placeholder: boolean } }) => ({
  thread: { id: threadId },
  initiator: "agent" as const,
  origin: "plugin" as const,
  originPluginId: PLUGIN_ID,
  experimental_submission: submission,
  input: { text: PLACEHOLDER, blocks: [{ type: "text" as const, text: PLACEHOLDER, mentions: [] }] },
});

/** The user types the goal with spaces and lines of their own. GOAL.md keeps every one. */
test("GOAL.md is the goal exactly as the user typed it", () => {
  const kit = setup();
  const typedGoal = "  Preserve this goal exactly.  \n\n- with a list\n";
  kit.dispatch(typed(MANAGER, typedGoal));
  assert.equal(kit.goal(), typedGoal);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("every message to a thread that is no regional manager's, or to one that has its goal, goes through", () => {
  const kit = setup();
  assert.deepEqual(kit.dispatch(typed("thr_other", "Hello")), PROCEED);
  assert.deepEqual(kit.dispatch({ ...typed("thr_other", "From a thread"), initiator: "agent", senderThreadId: "thr_sender" }), PROCEED);

  kit.dispatch(typed(MANAGER, "Migrate the webhook service"));
  assert.deepEqual(kit.dispatch(typed(MANAGER, "Also retire the cron box")), PROCEED);
  assert.deepEqual(kit.dispatch(doorbell("[Regional Manager] a1 handed off")), PROCEED);
  assert.deepEqual(kit.dispatch({ ...typed(MANAGER, "Steer"), attempt: "join-turn" }), PROCEED);
});

test("only the plugin's placeholder is held for good: on the spawn's own attempt, before the thread is known, and on every re-attempt of its row", () => {
  const kit = setup();
  assert.deepEqual(kit.dispatch(spawnAttempt("thr_unbound", { pluginId: PLUGIN_ID, data: { placeholder: true } })), WAIT);
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, queuedMessages: [placeholderRow("qm_placeholder")] }), WAIT);
  kit.dispatch(typed(MANAGER, "Migrate the webhook service"));
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, queuedMessages: [placeholderRow("qm_placeholder")] }), WAIT);

  // Not the placeholder: another plugin's submission, one of the plugin's own that isn't marked or doesn't carry its text, the same text from someone else, or a row of the plugin's that says something else.
  assert.deepEqual(kit.dispatch(spawnAttempt("thr_other", { pluginId: "another-plugin", data: { placeholder: true } })), PROCEED);
  assert.deepEqual(kit.dispatch(spawnAttempt("thr_other", { pluginId: PLUGIN_ID, data: { placeholder: false } })), PROCEED);
  assert.deepEqual(kit.dispatch(spawnAttempt("thr_other", { pluginId: PLUGIN_ID, data: null })), PROCEED);
  assert.deepEqual(kit.dispatch({ ...typed("thr_other", "Go"), experimental_submission: { pluginId: PLUGIN_ID, data: { placeholder: true } } }), PROCEED);
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, queuedMessages: [{ ...placeholderRow("qm_user"), origin: "app", originPluginId: null }] }), PROCEED);
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, queuedMessages: [{ ...placeholderRow("qm_doorbell"), content: [{ type: "text", text: "[Regional Manager] a1 handed off", mentions: [] }] }] }), PROCEED);
});

test("while it waits for its goal, every other message to the manager goes through and is not its goal: a doorbell, another thread's message, a message joining a turn", () => {
  const kit = setup();
  assert.deepEqual(kit.dispatch(doorbell("[Regional Manager] You saved PLAN.md")), PROCEED);
  assert.deepEqual(kit.dispatch({ ...typed(MANAGER, "From a thread"), initiator: "agent", senderThreadId: "thr_sender" }), PROCEED);
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, initiator: "user", senderThreadId: null, origin: "plugin", queuedMessages: [{ ...placeholderRow("qm_doorbell"), content: [{ type: "text", text: "[Regional Manager] You saved PLAN.md", mentions: [] }] }] }), PROCEED);
  assert.equal(kit.goal(), null);
  assert.equal(kit.store.awaitsGoal(ID), true);
});

test("the first message the user types is the goal, written to GOAL.md once: running the hook again on it, or on a later message, changes nothing", () => {
  const kit = setup();
  const goal = { ...typed(MANAGER, "ignored"), input: { text: "ignored", blocks: [{ type: "text" as const, text: "Migrate the webhook service", mentions: [] }, { type: "text" as const, text: "Hidden", visibility: "agent-only" as const, mentions: [] }, { type: "text" as const, text: "Keep the old endpoints", mentions: [] }] } };

  assert.deepEqual(kit.dispatch(goal), PROCEED);
  assert.equal(kit.goal(), "Migrate the webhook service\n\nKeep the old endpoints");
  assert.equal(kit.store.awaitsGoal(ID), false);
  assert.deepEqual(kit.boards, [ID]);

  assert.deepEqual(kit.dispatch(goal), PROCEED);
  assert.deepEqual(kit.dispatch(typed(MANAGER, "Something else")), PROCEED);
  assert.equal(kit.goal(), "Migrate the webhook service\n\nKeep the old endpoints");
  assert.deepEqual(kit.boards, [ID]);
});

test("a message the user queued while the placeholder ran, sent on a re-attempt, is the goal too", () => {
  const kit = setup();
  const queued = makeQueueEntry({ id: "qm_goal", threadId: MANAGER, origin: "app", content: [{ type: "text", text: "Migrate the webhook service", mentions: [] }] });
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, origin: "app", input: { text: "Migrate the webhook service", blocks: queued.content }, queuedMessages: [queued] }), PROCEED);
  assert.equal(kit.goal(), "Migrate the webhook service");
});

test("when its own code throws, the message goes through and the reason is logged", () => {
  const kit = setup();
  kit.store.roleOfThread = () => {
    throw new Error("database is locked");
  };
  assert.deepEqual(kit.dispatch(typed(MANAGER, "Migrate the webhook service")), PROCEED);
  assert.deepEqual(kit.warnings, [`Could not decide on a message to ${MANAGER}, so it goes through: database is locked`]);
});

test("the placeholder leaves the queue only once the manager has its goal: as its thread goes idle, and as bb tries it again", async () => {
  const kit = setup();
  await kit.idle(MANAGER);
  kit.dispatch({ thread: { id: MANAGER }, queuedMessages: [placeholderRow("qm_placeholder")] });
  await settle();
  assert.deepEqual(kit.queue.map(({ id }) => id), ["qm_placeholder"], "still held while the goal is awaited");

  kit.dispatch(typed(MANAGER, "Migrate the webhook service"));
  await kit.idle(MANAGER);
  assert.deepEqual(kit.queue.map(({ id }) => id), []);

  kit.queue.push(placeholderRow("qm_again"), makeQueueEntry({ id: "qm_user", threadId: MANAGER, origin: "app" }));
  assert.deepEqual(kit.dispatch({ thread: { id: MANAGER }, queuedMessages: [placeholderRow("qm_again")] }), WAIT);
  await settle();
  assert.deepEqual(kit.queue.map(({ id }) => id), ["qm_user"], "only the placeholder is taken out");

  await kit.idle(MANAGER);
  await kit.idle("thr_other");
  assert.deepEqual(kit.warnings, []);
});

test("the catch-up takes the goal from the user's first message the hook missed, skipping the placeholder sent anyway; with only the placeholder, it waits on", async () => {
  const kit = setup();
  const turn = (initiator: string, text: string, senderThreadId: string | null = null) => ({ data: { initiator, senderThreadId, input: [{ type: "text", text, mentions: [] }] } });
  kit.requested.push(turn("agent", PLACEHOLDER), turn("user", PLACEHOLDER));
  await kit.goals.recover(ID);
  assert.equal(kit.goal(), null);
  assert.equal(kit.store.awaitsGoal(ID), true);

  kit.requested.push(turn("agent", "From a thread", "thr_sender"), turn("user", "Migrate the webhook service"), turn("user", "And then this"));
  await kit.goals.recover(ID);
  assert.equal(kit.goal(), "Migrate the webhook service");
  assert.equal(kit.store.awaitsGoal(ID), false);
});

test("after the placeholder was sent anyway, the next message the user types is the goal", () => {
  const kit = setup();
  // The user's Send now on the placeholder skips the hook: bb sends it, and the hook never sees it.
  kit.queue.splice(0);
  assert.deepEqual(kit.dispatch(typed(MANAGER, "Migrate the webhook service")), PROCEED);
  assert.equal(kit.goal(), "Migrate the webhook service");
});
