import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { issueTurns } from "./issue-turns.ts";

const MANAGER = coordinatorIdSchema.parse("8a3f2c1e-1b2d-4c5e-8f90-123456789abc");
const I1 = issueIdSchema.parse("i1");
const I2 = issueIdSchema.parse("i2");
/** The plugin's instance, never disposed. */
const LIVE = new AbortController().signal;

/** A promise and the function that settles it. */
function held(): { done: Promise<void>; release: () => void } {
  let release = (): void => {};
  const done = new Promise<void>((resolve) => (release = resolve));
  return { done, release };
}

test("one issue's turns run one after another, in the order asked; another issue's run beside them", async () => {
  const turns = issueTurns(LIVE);
  const order: string[] = [];
  const first = held();
  const a = turns.run(MANAGER, I1, async () => {
    order.push("a starts");
    await first.done;
    order.push("a ends");
  });
  const b = turns.run(MANAGER, I1, async () => void order.push("b"));
  const other = turns.run(MANAGER, I2, async () => void order.push("i2"));
  await other;
  assert.deepEqual(order, ["a starts", "i2"], "b waits for a; i2 doesn't");
  first.release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a starts", "i2", "a ends", "b"]);
});

test("a turn that fails still ends, and the next one runs", async () => {
  const turns = issueTurns(LIVE);
  await assert.rejects(turns.run(MANAGER, I1, async () => assert.fail("bb refused")));
  assert.equal(await turns.run(MANAGER, I1, async () => "next"), "next");
});

test("a turn bb hasn't answered holds its issue until it settles: a caller that waited past the bound is refused, having run nothing, and the turns behind it still wait", async () => {
  const turns = issueTurns(LIVE, 20);
  const bb = held();
  const acted: string[] = [];
  const first = turns.run(MANAGER, I1, async () => {
    await bb.done;
    acted.push("first");
  });
  const refused = turns.run(MANAGER, I1, async () => void acted.push("refused"));
  assert.deepEqual(await refused, { busy: "an earlier operation on i1 hasn't finished yet, so nothing changed" });
  const behind = turns.run(MANAGER, I1, async () => void acted.push("behind"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(acted, [], "nothing ran beside the first, whose call is still out");
  bb.release();
  await first;
  await behind;
  assert.deepEqual(acted, ["first", "behind"]);
});

test("the tick's runIfFree skips an issue whose turn is held or waited for, and runs one that is free", async () => {
  const turns = issueTurns(LIVE);
  const bb = held();
  const holding = turns.run(MANAGER, I1, () => bb.done);
  const ran: string[] = [];
  assert.deepEqual(await turns.runIfFree(MANAGER, I1, async () => void ran.push("i1")), { busy: "an earlier operation on i1 hasn't finished yet, so nothing changed" });
  await turns.runIfFree(MANAGER, I2, async () => void ran.push("i2"));
  bb.release();
  await holding;
  await turns.runIfFree(MANAGER, I1, async () => void ran.push("i1 again"));
  assert.deepEqual(ran, ["i2", "i1 again"]);
});

test("once the plugin's instance is disposed, no turn is admitted, one already waiting included", async () => {
  const disposal = new AbortController();
  const turns = issueTurns(disposal.signal);
  const bb = held();
  const ran: string[] = [];
  const holding = turns.run(MANAGER, I1, () => bb.done);
  await new Promise((resolve) => setImmediate(resolve)); // the first turn is admitted
  const waiting = assert.rejects(turns.run(MANAGER, I1, async () => void ran.push("waiting")), /disposed/);
  disposal.abort(new Error("disposed"));
  bb.release();
  await holding;
  await waiting;
  await assert.rejects(turns.runIfFree(MANAGER, I2, async () => void ran.push("i2")), /disposed/);
  assert.deepEqual(ran, []);
});
