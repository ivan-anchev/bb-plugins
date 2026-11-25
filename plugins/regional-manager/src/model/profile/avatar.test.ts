import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarSchema, freeLook, HUE_NAMES, randomStart, SHAPES, shuffledLook, type Avatar } from "./avatar.ts";

const lookKey = ({ shape, hue }: Avatar) => `${shape}/${hue}`;

const everyLook = HUE_NAMES.flatMap((hue) => SHAPES.map((shape) => avatarSchema.parse({ kind: "blob", shape, hue, expression: "neutral" })));

test("Shuffle picks a free look other than the current one while there is one", () => {
  const [current, other, ...taken] = everyLook;
  assert.ok(current && other);

  const look = shuffledLook(randomStart(), taken, current);

  assert.equal(lookKey(look), lookKey(other));
});

test("Shuffle never lands on a taken look while a free one is left: with 230 taken and the current one free, it keeps the current one", () => {
  const [current, ...taken] = everyLook;
  assert.ok(current);

  assert.deepEqual(shuffledLook(randomStart(), taken, current), current);
});

test("a free look is never one a manager has, and is a whole blob avatar with the neutral face", () => {
  const start = randomStart();
  const seeded = freeLook(start, []);
  const look = freeLook(start, [seeded]);

  assert.notEqual(lookKey(look), lookKey(seeded));
  assert.deepEqual(avatarSchema.parse(look), look);
  assert.equal(look.expression, "neutral");
});

test("a look with any face but the neutral one is not a manager's avatar", () => {
  assert.equal(avatarSchema.safeParse({ kind: "blob", shape: "cat", hue: "teal", expression: "happy" }).success, false);
});

test("the same start gives the same look", () => {
  const start = randomStart();
  assert.deepEqual(freeLook(start, []), freeLook(start, []));
});
