import assert from "node:assert/strict";
import { setImmediate as settled } from "node:timers/promises";
import { test } from "node:test";
import type { ComputerView } from "../../contract.ts";
import { readComputerEvery, type ComputerReading } from "./computer-reader.ts";

const BEFORE_STOP: ComputerView = { status: "ready", url: "https://box-node-1-6080.on.boat.dev/vnc.html?_token=before" };
const AFTER_RESUME: ComputerView = { status: "ready", url: "https://box-node-1-6080.on.boat.dev/vnc.html?_token=after" };

/** Opens the page: a reader that answers with `answer()`, and every reading it showed, latest last. */
function open(answer: () => Promise<ComputerView>) {
  const shown: ComputerReading[] = [];
  const close = readComputerEvery(answer, (reading) => shown.push(reading), () => true);
  return { shown, close };
}

test("a page opened again never shows the last look's desktop: it shows the failure until a read of its own succeeds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const firstLook = open(async () => BEFORE_STOP);
  await settled();
  assert.deepEqual(firstLook.shown.at(-1), { view: BEFORE_STOP, failure: null });
  firstLook.close();

  let answer = (): Promise<ComputerView> => Promise.reject(new Error("boat is unreachable"));
  const page = open(() => answer());
  await settled();
  assert.deepEqual(page.shown, [{ view: undefined, failure: "boat is unreachable" }]);

  answer = async () => AFTER_RESUME;
  t.mock.timers.tick(10_000);
  await settled();
  assert.deepEqual(page.shown.at(-1), { view: AFTER_RESUME, failure: null });
  page.close();
});

test("a failed read after a good one keeps that desktop and says why", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let answer = async (): Promise<ComputerView> => AFTER_RESUME;
  const page = open(() => answer());
  await settled();
  answer = () => Promise.reject(new Error("boat is unreachable"));
  t.mock.timers.tick(10_000);
  await settled();
  assert.deepEqual(page.shown.at(-1), { view: AFTER_RESUME, failure: "boat is unreachable" });
  page.close();
});

test("a closed page reads no more", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const page = open(async () => (reads++, { status: "starting" }));
  await settled();
  page.close();
  t.mock.timers.tick(60_000);
  await settled();
  assert.equal(reads, 1);
});
