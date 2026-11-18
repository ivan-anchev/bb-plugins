import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "../../contract.ts";
import { coordinating, doorbellOf, settled, startedAgent, textOf } from "../test-harness.ts";

/** A Coordinator whose first turn is running, in its own environment. */
async function working() {
  const started = await coordinating();
  const { kit, threadId, coordinatorId } = started;
  const environmentId = kit.environment(threadId);
  return {
    ...started,
    environmentId,
    /** Its turn ends with `fileCount` changed files in its working tree, and every ring it started has run. */
    async turnEnds(fileCount: number): Promise<void> {
      kit.git.changedFiles.set(environmentId, fileCount);
      await kit.idle(threadId, "Done.");
      await settled();
    },
    /**
     * Its turn ends with `fileCount` changed files, and bb's git plugin holds its answer, read now,
     * until `answer` is called.
     */
    async turnEndsHeld(fileCount: number): Promise<{ answer(): Promise<void> }> {
      kit.git.holding = true;
      kit.git.changedFiles.set(environmentId, fileCount);
      const held = kit.git.held.length;
      const idle = kit.idle(threadId, "Done.");
      await settled();
      const release = kit.git.held[held] ?? assert.fail("the read never reached bb's git plugin");
      return {
        async answer() {
          release();
          await idle;
          await settled();
        },
      };
    },
    /** Every doorbell that reached it, in order. */
    doorbells: () => kit.doorbellsDelivered(threadId),
    /** The board's warning, as the app reads it: bb parses each RPC's result with its contract. */
    warning: async () => coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId })).ownEdits,
    catchUp: async () => textOf(await kit.call("crew_catch_up", {}, threadId)),
  };
}

test("a turn that ends with changed files in the Coordinator's own environment warns on the board and wakes it to hand the change to an agent", async () => {
  const { turnEnds, doorbells, warning, catchUp } = await working();
  await turnEnds(2);

  const shown = await warning();
  assert.equal(shown?.fileCount, 2);
  assert.ok(shown !== null && Math.abs(shown.at - Date.now()) < 5_000, "with when its turn ended");
  assert.deepEqual(doorbells(), [doorbellOf(`Your own environment has 2 files changed after your turn: hand the change to an agent`)]);
  const text = await catchUp();
  assert.match(text, /### Your own environment has 2 files changed\n\nAt [^\n]+ bb's git plugin read changed files in your working tree when your turn ended/);
  assert.match(text, /you never touch your working tree: no stash, revert, checkout or deletion/);
  assert.match(text, /First propose, in a crew_ask_user decision, an issue whose agent redoes the change properly on its own branch, always, whatever the user's preferences: .* In the same decision, ask the user whether to discard the changes in your environment: discarding them is theirs to do, never yours\./);
  assert.doesNotMatch(text, /git stash/);
});

test("a second turn that ends with the same count records nothing new; a different count warns again", async () => {
  const { kit, turnEnds, doorbells, warning, catchUp } = await working();
  await turnEnds(1);
  await catchUp();
  await turnEnds(1);
  assert.equal(doorbells().length, 1, "no second wake");
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
  assert.equal((await warning())?.fileCount, 1, "the warning stays");

  kit.reload();
  await turnEnds(1);
  assert.equal(doorbells().length, 1, "already warned is read from the stored event, so a reload doesn't warn again");

  await turnEnds(3);
  assert.equal(doorbells().length, 2);
  assert.match(doorbells()[1]?.facts ?? "", /^Your own environment has 3 files changed after your turn/);
  assert.equal((await warning())?.fileCount, 3);
});

test("a clean tree after a warning clears the board line, and is told in the next catch-up without waking the Coordinator", async () => {
  const { turnEnds, doorbells, warning, catchUp } = await working();
  await turnEnds(1);
  await catchUp();
  await turnEnds(0);

  assert.equal(await warning(), null);
  assert.equal(doorbells().length, 1, "a clean tree alone wakes nobody");
  assert.match(await catchUp(), /### Your own environment is clean again\n\nAt [^\n]+ Your turn ended with no changed files in your working tree/);

  await turnEnds(0);
  assert.match(await catchUp(), /Nothing new since your last catch-up/, "clean again is recorded once");
});

test("a clean tree with no warning before it records nothing", async () => {
  const { turnEnds, doorbells, warning, catchUp } = await working();
  await turnEnds(0);
  assert.equal(await warning(), null);
  assert.deepEqual(doorbells(), []);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
});

test("a Coordinator in a non-git environment records nothing, and nothing is logged", async () => {
  const { kit, environmentId, turnEnds, doorbells, warning, catchUp } = await working();
  kit.git.nonGit.add(environmentId);
  await turnEnds(4);
  assert.deepEqual(kit.git.calls, [[environmentId]], "its environment was read");
  assert.equal(await warning(), null);
  assert.deepEqual(doorbells(), []);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
  assert.deepEqual(kit.warnings(), []);
});

test("a read bb's git plugin can't make, or answers in a shape the plugin can't read, records nothing and keeps the warning as it was", async () => {
  const { kit, environmentId, turnEnds, doorbells, warning } = await working();
  await turnEnds(1);

  kit.git.offline.add(environmentId);
  await turnEnds(0);
  kit.git.offline.clear();
  // why off-type: it stands in for an outcome a newer bb--git may answer.
  kit.git.newer.set(environmentId, { outcome: "rebasing", step: 3 });
  await turnEnds(0);

  assert.equal((await warning())?.fileCount, 1, "no read proved the tree clean");
  assert.equal(doorbells().length, 1);
  assert.deepEqual(kit.warnings(), [
    `Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: The environment's machine is offline`,
    `Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: bb's git plugin answered "rebasing" in a shape this plugin can't read`,
  ]);
});

test("an agent's changed files are its work: only the regional manager's own turns are read", async () => {
  const { kit, threadId, warning } = await working();
  const agentThreadId = (await startedAgent(kit, threadId)).agentThreadId;
  kit.git.changedFiles.set(kit.environment(agentThreadId), 5);
  await kit.idle(agentThreadId, "Halfway.");
  await settled();
  assert.deepEqual(kit.git.calls, [], "no read for an agent's turn");
  assert.equal(await warning(), null);
});

test("a read answered after a newer one is ignored: an old clean read never clears a newer warning", async () => {
  const { turnEnds, turnEndsHeld, doorbells, warning } = await working();
  await turnEnds(1);
  const older = await turnEndsHeld(0);
  const newer = await turnEndsHeld(2);
  await newer.answer();
  await older.answer();

  assert.equal((await warning())?.fileCount, 2);
  assert.equal(doorbells().length, 2);
});

test("a read answered after a newer one is ignored: an old dirty read never brings back a cleared warning", async () => {
  const { turnEnds, turnEndsHeld, doorbells, warning, catchUp } = await working();
  await turnEnds(1);
  await catchUp();
  const older = await turnEndsHeld(3);
  const newer = await turnEndsHeld(0);
  await newer.answer();
  await older.answer();

  assert.equal(await warning(), null);
  assert.equal(doorbells().length, 1, "no wake for the old read");
  assert.match(await catchUp(), /### Your own environment is clean again/);
});

test("a read still waiting when the plugin is reloaded or disabled records nothing when it's answered", async () => {
  const { kit, turnEndsHeld, doorbells, warning, catchUp } = await working();
  const pending = await turnEndsHeld(2);
  kit.reload();
  await pending.answer();

  assert.equal(await warning(), null);
  assert.deepEqual(doorbells(), []);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
  assert.deepEqual(kit.warnings(), []);
});
