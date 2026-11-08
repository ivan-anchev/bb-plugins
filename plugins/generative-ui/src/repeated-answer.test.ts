import assert from "node:assert/strict";
import { test } from "node:test";
import { isRepeatedAnswer } from "./repeated-answer.ts";

const answer = "QA answer\n\n- name: QA One\n- email: qa@example.com";

test("a block's first answer is never a repeat", () => {
  assert.equal(isRepeatedAnswer(undefined, { text: answer, at: 0 }), false);
});

test("the same answer again within a double-click is a repeat", () => {
  const first = { text: answer, at: 1000 };
  assert.equal(isRepeatedAnswer(first, { text: answer, at: 1007 }), true);
  assert.equal(isRepeatedAnswer(first, { text: answer, at: 1213 }), true);
  assert.equal(isRepeatedAnswer(first, { text: answer, at: 1999 }), true);
});

test("the same answer sent again a moment later goes through", () => {
  assert.equal(isRepeatedAnswer({ text: answer, at: 1000 }, { text: answer, at: 2000 }), false);
});

test("a changed answer goes through at once", () => {
  const edited = "QA answer\n\n- name: QA Two\n- email: qa@example.com";
  assert.equal(isRepeatedAnswer({ text: answer, at: 1000 }, { text: edited, at: 1050 }), false);
});
