import "../../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFollowing } from "./use-following.ts";

// The Managers view's one follower: only the avatar under the pointer follows, the one it left eases
// home and then holds still, and a new hover stills the one easing home at once.

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const mouse = { pointerType: "mouse" } as const;
const touch = { pointerType: "touch" } as const;

function mountFollower() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { result } = renderHook(() => useFollowing());
  const states = () => ["a", "b"].map((key) => result.current(key).following);
  const enter = (key: string, e: { pointerType: "mouse" | "touch" } = mouse) => act(() => result.current(key).pointer.onPointerEnter(e));
  const leave = (key: string, e: { pointerType: "mouse" | "touch" } = mouse) => act(() => result.current(key).pointer.onPointerLeave(e));
  const wait = (ms: number) => act(() => mock.timers.tick(ms));
  return { states, enter, leave, wait };
}

test("the hovered avatar follows; left, it eases home, then holds still within a second", () => {
  const { states, enter, leave, wait } = mountFollower();
  enter("a");
  assert.deepEqual(states(), ["on", "off"]);
  leave("a");
  assert.deepEqual(states(), ["easing-home", "off"]);
  wait(899);
  assert.deepEqual(states(), ["easing-home", "off"]);
  wait(1);
  assert.deepEqual(states(), ["off", "off"]);
});

test("sweeping from one manager straight to another: the one left holds still at once, only the new one moves", () => {
  const { states, enter, leave, wait } = mountFollower();
  enter("a");
  leave("a");
  enter("b");
  assert.deepEqual(states(), ["off", "on"]);
  wait(1000);
  assert.deepEqual(states(), ["off", "on"], "the timer the first one left behind doesn't still the second");
});

test("a touch sets nothing off", () => {
  const { states, enter, leave } = mountFollower();
  enter("a", touch);
  leave("a", touch);
  assert.deepEqual(states(), ["off", "off"]);
});
