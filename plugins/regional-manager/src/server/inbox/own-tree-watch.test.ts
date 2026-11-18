import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "../../contract.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { coordinating, settled, startedAgent, textOf } from "../test-harness.ts";

/** A Coordinator whose first turn is running, in its own environment. */
async function working() {
  const started = await coordinating();
  const { kit, threadId, coordinatorId } = started;
  const environmentId = kit.environment(threadId);
  return {
    ...started,
    environmentId,
    /** Its turn ends with the `changed` files in its working tree, and every ring it started has run. */
    async turnEnds(changed: string[]): Promise<void> {
      kit.git.changedFiles.set(environmentId, changed);
      await kit.idle(threadId, "Done.");
      await settled();
    },
    /** Its turn ends with the `changed` files, and bb's git plugin holds its answer, read now, until `answer` is called. */
    async turnEndsHeld(changed: string[]): Promise<{ answer(): Promise<void> }> {
      kit.git.holding = true;
      kit.git.changedFiles.set(environmentId, changed);
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
    /** Every doorbell that reached it, in order, whether or not the user sees it. */
    doorbells: () => kit.delivered(threadId).filter((text) => text.startsWith(`[${DISPLAY_NAME}]`)),
    /** Every message of the plugin's that the user's timeline shows. */
    shownToUser: () => kit.shownToUser(threadId).filter((text) => text.startsWith(`[${DISPLAY_NAME}]`)),
    /** The board, as the app reads it: bb parses each RPC's result with its contract. */
    board: async () => coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId })),
    catchUp: async () => textOf(await kit.call("crew_catch_up", {}, threadId)),
  };
}

const CHANGED_LINE = (count: string) => `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- Your turn ended with ${count} in your checkout`;
const CORRECTION = /### Your turn ended with ([^\n]+) in your checkout/g;
/** The corrections a catch-up gives, by the count each names. */
const corrections = (text: string): string[] => [...text.matchAll(CORRECTION)].map((match) => match[1] ?? "");
/** The line under the identity line while the checkout has changed files. */
const CHECKOUT_LINE = (count: string) => `Your checkout has ${count}: your checkout is no longer a copy of the default branch: read origin/main when you plan.`;
/** Any git command that would change the manager's checkout. */
const MUTATING_GIT = /git (?:-\S+ )*(?:switch|checkout|add|commit|stash|reset|restore|clean|rm|mv|cherry-pick|apply|revert|rebase|merge)\b/;

test("a turn that ends with changed files wakes the Coordinator unseen by the user, puts nothing on the board, and has it leave the files as they are", async () => {
  const { turnEnds, doorbells, shownToUser, board, catchUp } = await working();
  await turnEnds(["src/app.ts", "it's new.md"]);

  assert.deepEqual(doorbells(), [CHANGED_LINE("2 changed files")]);
  assert.deepEqual(shownToUser(), [], "the user's timeline shows nothing");
  const shown = await board();
  assert.deepEqual(Object.keys(shown).sort(), ["decisions", "digest", "issues", "prUnavailable", "verify"], "no warning on the board");
  assert.deepEqual(shown.decisions, [], "and no question");

  const text = await catchUp();
  assert.match(text, /^You are regional manager [\w-]+: the plugin made this thread one when it started it\.\n/);
  assert.equal(text.split("\n")[1], CHECKOUT_LINE("2 changed files"));
  assert.deepEqual(corrections(text), ["2 changed files"]);
  assert.match(text, /The plugin knows which files changed, not who changed them, and showed the user nothing of it\. If the user told you in their own message to change them, or you didn't change them, leave them and carry on, and say nothing of them\./);
  assert.match(text, /Otherwise that was not your job: leave the files exactly as they are, and file an issue whose agent does the work properly from the default branch, with what you learned in its brief\. You may read your own diff to write that brief\./);
  assert.doesNotMatch(text, MUTATING_GIT, "no command that changes the checkout");
});

test("the same files at the next turn's end wake nobody, after a reload too; other files do, with one correction", async () => {
  const { kit, turnEnds, doorbells, catchUp } = await working();
  await turnEnds(["a.ts"]);
  await catchUp();
  await turnEnds(["a.ts"]);
  assert.equal(doorbells().length, 1, "no second wake");
  assert.deepEqual(corrections(await catchUp()), []);

  kit.reload();
  await turnEnds(["a.ts"]);
  assert.equal(doorbells().length, 1, "the last read is read from the store, so a reload doesn't tell it again");

  await turnEnds(["a.ts", "b.ts"]);
  assert.deepEqual(doorbells().at(-1), CHANGED_LINE("2 changed files"));
  assert.deepEqual(corrections(await catchUp()), ["2 changed files"]);
});

test("two turn ends before a catch-up leave one correction, of the newer read; a clean read after a changed one leaves none", async () => {
  const { turnEnds, catchUp } = await working();
  await turnEnds(["a.txt"]);
  await turnEnds(["a.txt", "b.txt"]);
  assert.deepEqual(corrections(await catchUp()), ["2 changed files"], "the older one was retired");

  await turnEnds(["c.txt"]);
  await turnEnds([]);
  const text = await catchUp();
  assert.deepEqual(corrections(text), [], "the clean read retired it");
  assert.match(text, /^You are regional manager [\w-]+: the plugin made this thread one when it started it\.\n\n## Updates\n\nNothing new since your last catch-up\./, "and no checkout line");
});

test("a list bb's git plugin capped is told as \"at least\" its count, in the wake and the catch-up", async () => {
  const { turnEnds, doorbells, catchUp } = await working();
  await turnEnds(Array.from({ length: 201 }, (_, i) => `f${String(i).padStart(3, "0")}.txt`));

  assert.deepEqual(doorbells(), [CHANGED_LINE("at least 201 changed files")]);
  const text = await catchUp();
  assert.deepEqual(corrections(text), ["at least 201 changed files"]);
  assert.equal(text.split("\n")[1], CHECKOUT_LINE("at least 201 changed files"));
});

test("catch-up says the checkout has changed files for as long as it has, and stops once it is clean", async () => {
  const { kit, threadId, turnEnds, catchUp } = await working();
  await turnEnds(["a.ts"]);
  await catchUp();
  assert.equal((await catchUp()).split("\n")[1], CHECKOUT_LINE("1 changed file"), "the correction was read, the line stays");
  await kit.idle(threadId, "Still there.");
  await settled();
  assert.equal((await catchUp()).split("\n")[1], CHECKOUT_LINE("1 changed file"));

  await turnEnds([]);
  assert.equal((await catchUp()).split("\n")[1], "");
});

test("a Coordinator in a non-git environment records nothing, and nothing is logged", async () => {
  const { kit, environmentId, turnEnds, doorbells, catchUp } = await working();
  kit.git.nonGit.add(environmentId);
  await turnEnds(["a.ts"]);
  assert.deepEqual(kit.git.calls, [[environmentId]], "its environment was read");
  assert.deepEqual(doorbells(), []);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
  assert.deepEqual(kit.warnings(), []);
});

test("a read bb's git plugin can't make, or answers in a shape the plugin can't read, records nothing", async () => {
  const { kit, environmentId, turnEnds, doorbells } = await working();
  await turnEnds(["a.ts"]);

  kit.git.offline.add(environmentId);
  await turnEnds([]);
  kit.git.offline.clear();
  // why off-type: it stands in for an outcome a newer bb--git may answer.
  kit.git.newer.set(environmentId, { outcome: "rebasing", step: 3 });
  await turnEnds([]);
  kit.git.newer.clear();
  await turnEnds(["a.ts"]);

  assert.equal(doorbells().length, 1, "no read proved the tree clean, so the same files aren't told again");
  assert.deepEqual(kit.warnings(), [
    `Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: The environment's machine is offline`,
    `Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: bb's git plugin answered "rebasing" in a shape this plugin can't read`,
  ]);
});

test("an agent's changed files are its work: only the regional manager's own turns are read", async () => {
  const { kit, threadId, doorbells } = await working();
  const agentThreadId = (await startedAgent(kit, threadId)).agentThreadId;
  kit.git.changedFiles.set(kit.environment(agentThreadId), ["a.ts"]);
  await kit.idle(agentThreadId, "Halfway.");
  await settled();
  assert.deepEqual(kit.git.calls, [], "no read for an agent's turn");
  assert.deepEqual(doorbells(), []);
});

test("a read answered after a newer one is ignored: an old clean read never forgets newer changed files", async () => {
  const { kit, turnEnds, turnEndsHeld, doorbells } = await working();
  await turnEnds(["a.ts"]);
  const older = await turnEndsHeld([]);
  const newer = await turnEndsHeld(["a.ts", "b.ts"]);
  await newer.answer();
  await older.answer();
  kit.git.holding = false;
  await turnEnds(["a.ts", "b.ts"]);

  assert.equal(doorbells().length, 2, "a.ts, then a.ts and b.ts, each told once");
});

test("a read answered after a newer one is ignored: an old changed read never tells of files gone since", async () => {
  const { turnEnds, turnEndsHeld, doorbells } = await working();
  await turnEnds(["a.ts"]);
  const older = await turnEndsHeld(["a.ts", "b.ts"]);
  const newer = await turnEndsHeld([]);
  await newer.answer();
  await older.answer();

  assert.equal(doorbells().length, 1, "no wake for the old read");
});

test("a read still waiting when the plugin is reloaded or disabled records nothing when it's answered", async () => {
  const { kit, turnEndsHeld, doorbells, catchUp } = await working();
  const pending = await turnEndsHeld(["a.ts"]);
  kit.reload();
  await pending.answer();

  assert.deepEqual(doorbells(), []);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
  assert.deepEqual(kit.warnings(), []);
});
