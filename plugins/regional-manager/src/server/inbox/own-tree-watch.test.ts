import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "../../contract.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { coordinating, isRefusal, settled, startedAgent, textOf } from "../test-harness.ts";

/** A Coordinator whose first turn is running, in its own environment. */
async function working() {
  const started = await coordinating();
  const { kit, threadId, coordinatorId } = started;
  const environmentId = kit.environment(threadId);
  return {
    ...started,
    environmentId,
    /** Its working tree has the `changed` files now, as during its turn. */
    edits(changed: string[]): void {
      kit.git.changedFiles.set(environmentId, changed);
    },
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
    keep: () => kit.call("keep_edits", {}, threadId),
  };
}

const DRAFT_LINE = (count: string) => `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- Your turn left ${count} changed that the user didn't ask for: hand the draft to an agent`;

test("a turn that leaves files the user didn't ask for wakes the Coordinator unseen by the user, puts nothing on the board, and says how to save the draft and hand it to an agent", async () => {
  const { turnEnds, doorbells, shownToUser, board, catchUp } = await working();
  await turnEnds(["src/app.ts", "it's new.md"]);

  assert.deepEqual(doorbells(), [DRAFT_LINE("2 files")]);
  assert.deepEqual(shownToUser(), [], "the user's timeline shows nothing");
  const shown = await board();
  assert.deepEqual(Object.keys(shown).sort(), ["decisions", "digest", "issues", "prUnavailable", "verify"], "no warning on the board");
  assert.deepEqual(shown.decisions, [], "and no question");

  const text = await catchUp();
  assert.match(text, /### Your turn left 2 files changed that the user didn't ask for\n\nAt [^\n]+ `src\/app\.ts`, `it's new\.md`\. You don't edit files yourself: an agent does\. Put it right in this turn, then end it with no reply: the plugin showed the user nothing/);
  const branch = /git switch -c (regional-manager\/\S+\/draft-\w+) && /.exec(text)?.[1] ?? assert.fail(text);
  assert.ok(text.includes(`\`git switch -c ${branch} && git add -A -- 'src/app.ts' 'it'\\''s new.md' && git commit -qm "Regional manager draft" && git switch -\``), "one command saves exactly those files on the draft's branch");
  assert.match(text, /Never stash, revert or delete it/);
  assert.ok(text.includes(`whose brief starts "Start from the regional manager's draft: run \`git cherry-pick ${branch}\` first."`));
  assert.match(text, /If the user's own message told you to make exactly these changes yourself, call keep_edits instead\./);
});

test("the same draft at the next turn's end wakes nobody, after a reload too; another one does, on a branch of its own", async () => {
  const { kit, turnEnds, doorbells, catchUp } = await working();
  await turnEnds(["a.ts"]);
  const first = await catchUp();
  await turnEnds(["a.ts"]);
  assert.equal(doorbells().length, 1, "no second wake");
  assert.match(await catchUp(), /Nothing new since your last catch-up/);

  kit.reload();
  await turnEnds(["a.ts"]);
  assert.equal(doorbells().length, 1, "the draft told of is read from the store, so a reload doesn't tell it again");

  await turnEnds(["a.ts", "b.ts"]);
  assert.deepEqual(doorbells().at(-1), DRAFT_LINE("2 files"));
  const branchOf = (text: string) => /git switch -c (\S+) /.exec(text)?.[1];
  assert.notEqual(branchOf(await catchUp()), branchOf(first));
});

test("a draft saved leaves a clean tree, which wakes nobody and is told of nowhere", async () => {
  const { turnEnds, doorbells, catchUp } = await working();
  await turnEnds(["a.ts"]);
  await catchUp();
  await turnEnds([]);

  assert.equal(doorbells().length, 1);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);
});

test("files the user asked the Coordinator to change, kept with keep_edits, are left as they are: no wake, no word; a file it changes later is a draft of its own", async () => {
  const { edits, turnEnds, doorbells, catchUp, keep } = await working();
  edits(["README.md"]);
  assert.equal(textOf(await keep()), "Kept `README.md` as the user asked: the plugin won't take it for a draft.");
  await turnEnds(["README.md"]);
  await turnEnds(["README.md"]);
  assert.deepEqual(doorbells(), []);
  assert.match(await catchUp(), /Nothing new since your last catch-up/);

  await turnEnds(["README.md", "src/app.ts"]);
  assert.deepEqual(doorbells(), [DRAFT_LINE("1 file")]);
  assert.match(await catchUp(), /`src\/app\.ts`\. You don't edit[^\n]*\n\n1\. [^\n]*git add -A -- 'src\/app\.ts' && /, "only the draft is saved; the kept file stays in the tree");
});

test("a kept file once clean again is forgotten: changed later, it is a draft", async () => {
  const { edits, turnEnds, doorbells, keep } = await working();
  edits(["README.md"]);
  await keep();
  await turnEnds([]);
  await turnEnds(["README.md"]);
  assert.deepEqual(doorbells(), [DRAFT_LINE("1 file")]);
});

test("keep_edits on a clean tree keeps nothing; one whose tree can't be read is refused and keeps nothing", async () => {
  const { kit, environmentId, turnEnds, doorbells, keep } = await working();
  assert.equal(textOf(await keep()), "Your working tree has no changed files, so there is nothing to keep.");

  kit.git.changedFiles.set(environmentId, ["README.md"]);
  kit.git.offline.add(environmentId);
  const refused = await keep();
  assert.ok(isRefusal(refused));
  assert.equal(textOf(refused), "keep_edits is refused: bb's git plugin can't read your working tree now. Call it again in a minute.");
  kit.git.offline.clear();
  await turnEnds(["README.md"]);
  assert.deepEqual(doorbells(), [DRAFT_LINE("1 file")]);
});

test("only a regional manager can keep edits", async () => {
  const { kit, threadId } = await working();
  const agentThreadId = (await startedAgent(kit, threadId)).agentThreadId;
  const refused = await kit.call("keep_edits", {}, agentThreadId);
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /^keep_edits is refused: only a regional manager can use it/);
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

  assert.equal(doorbells().length, 1, "no read proved the tree clean, so the same draft isn't told again");
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
  assert.equal(doorbells().filter((text) => text.includes("draft")).length, 0);
});

test("a read answered after a newer one is ignored: an old clean read never forgets a newer draft", async () => {
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

test("a read answered after a newer one is ignored: an old dirty read never tells of a draft already saved", async () => {
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
