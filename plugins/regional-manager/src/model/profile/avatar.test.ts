import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarSchema, freeLook, HUE_NAMES, randomStart, SHAPES, type Avatar } from "./avatar.ts";

const lookKey = ({ shape, hue }: Avatar) => `${shape}/${hue}`;

test("new regional managers, each given a free look from a random start, all look different until the 21 shapes in 12 hues run out", () => {
  const taken: Avatar[] = [];
  for (let n = 0; n < 252; n++) taken.push(freeLook(randomStart(), taken));

  assert.equal(new Set(taken.map(lookKey)).size, 252);
  assert.deepEqual(new Set(taken.map(({ shape }) => shape)), new Set(SHAPES));
  assert.deepEqual(new Set(taken.map(({ hue }) => hue)), new Set(HUE_NAMES));
  const once = freeLook(randomStart(), taken);
  assert.ok(taken.some((look) => lookKey(look) === lookKey(once)), "the 253rd shares a look, as none is left");
});

test("a free look is never one a manager has, whatever its face, and is a whole blob avatar", () => {
  const start = randomStart();
  const seeded = freeLook(start, []);
  const look = freeLook(start, [{ ...seeded, expression: seeded.expression === "happy" ? "neutral" : "happy" }]);

  assert.notEqual(lookKey(look), lookKey(seeded));
  assert.deepEqual(avatarSchema.parse(look), look);
});

test("the same start gives the same look", () => {
  const start = randomStart();
  assert.deepEqual(freeLook(start, []), freeLook(start, []));
});
