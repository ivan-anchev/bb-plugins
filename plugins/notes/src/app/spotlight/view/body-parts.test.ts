import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyParts } from "./body-parts.ts";

test("a note with no links is one plain part", () => {
  assert.deepEqual(bodyParts({ text: "Check the chart", mentions: [] }), [{ text: "Check the chart", threadId: null }]);
});

test("each link is its own part, labelled with the text it covers", () => {
  const text = "check @Burn weekly later, see @Spend";
  const mentions = [
    { threadId: "thr_weekly", from: 6, to: 18 },
    { threadId: "thr_spend", from: 30, to: 36 },
  ];

  assert.deepEqual(bodyParts({ text, mentions }), [
    { text: "check ", threadId: null },
    { text: "@Burn weekly", threadId: "thr_weekly" },
    { text: " later, see ", threadId: null },
    { text: "@Spend", threadId: "thr_spend" },
  ]);
});

test("links side by side, or at the very start, leave no empty parts", () => {
  const text = "@A@B";
  const mentions = [
    { threadId: "thr_a", from: 0, to: 2 },
    { threadId: "thr_b", from: 2, to: 4 },
  ];

  assert.deepEqual(bodyParts({ text, mentions }), [
    { text: "@A", threadId: "thr_a" },
    { text: "@B", threadId: "thr_b" },
  ]);
});
