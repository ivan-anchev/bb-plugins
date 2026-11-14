import assert from "node:assert/strict";
import { test } from "node:test";
import { Playing, type Played } from "./playing.ts";

/** An animation that runs until told to finish, or is cancelled: as a Web Animation, `finished` then rejects. */
function animation() {
  let finish!: () => void;
  let abort!: (e: Error) => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    abort = reject;
  });
  const a = {
    cancelled: false,
    finished,
    cancel() {
      a.cancelled = true;
      abort(new Error("AbortError"));
    },
    finish,
  };
  return a satisfies Played;
}

/** Lets every settled `finished` reach its continuation. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

test("torn down mid-play, every animation stops and none lands", async () => {
  const playing = new Playing();
  const [glide, fade] = [animation(), animation()];
  const landed: string[] = [];
  playing.hold([glide, fade], () => landed.push("plan"));
  playing.tearDown();
  await settle();
  assert.deepEqual([glide.cancelled, fade.cancelled, landed], [true, true, []]);
});

test("while the list stands, overlapping plans each land as theirs end, and stopping lands the rest", async () => {
  const playing = new Playing();
  const [first, second] = [animation(), animation()];
  const landed: string[] = [];
  playing.hold([first], () => landed.push("first"));
  playing.hold([second], () => landed.push("second"));
  first.finish();
  await settle();
  assert.deepEqual(landed, ["first"]);
  playing.stop();
  await settle();
  assert.deepEqual([first.cancelled, second.cancelled, landed], [false, true, ["first", "second"]]);
});
