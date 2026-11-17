import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { issueTurns } from "./issue-turns.ts";

const MANAGER = coordinatorIdSchema.parse("8a3f2c1e-1b2d-4c5e-8f90-123456789abc");
const I1 = issueIdSchema.parse("i1");
const I2 = issueIdSchema.parse("i2");

/** A promise and the function that settles it. */
function held(): { done: Promise<void>; release: () => void } {
  let release = (): void => {};
  const done = new Promise<void>((resolve) => (release = resolve));
  return { done, release };
}

test("one issue's turns run one after another, in the order asked; another issue's run beside them", async () => {
  const turns = issueTurns();
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
  const turns = issueTurns();
  await assert.rejects(turns.run(MANAGER, I1, async () => assert.fail("bb refused")));
  assert.equal(await turns.run(MANAGER, I1, async () => "next"), "next");
});

test("a turn bb never answers holds its issue only for its lease: the next one runs, and the late one does nothing more", async () => {
  const turns = issueTurns(20);
  const bb = held();
  const acted: string[] = [];
  const late = turns.run(MANAGER, I1, async (turn) => {
    await bb.done;
    turn.check();
    acted.push("late");
  });
  await turns.run(MANAGER, I1, async () => void acted.push("next"));
  assert.deepEqual(acted, ["next"], "the next turn ran once the lease was over");
  bb.release();
  await assert.rejects(late, /bb took over 0.02 seconds to answer, so i1 went on to what waited behind this, and nothing more was done here\./);
  assert.deepEqual(acted, ["next"]);
});
