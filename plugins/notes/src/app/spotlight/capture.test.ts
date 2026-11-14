import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadChatMessageReference } from "@get-bb/plugin-sdk";
import { captureFrom } from "./capture.ts";

function message(role: ThreadChatMessageReference["role"]): ThreadChatMessageReference {
  return { id: "msg_1", threadId: "thr_abc", role, text: "Burn reports cents. The card sums them.", sourceSeqEnd: 44, experimental_messageSeq: 41 };
}

test("a selection quotes exactly the highlighted text, anchored to the message link's seq", () => {
  assert.deepEqual(captureFrom({ threadId: "thr_abc", message: message("assistant"), selectedText: "Burn reports cents" }), {
    text: "Burn reports cents",
    threadId: "thr_abc",
    messageSeq: 41,
  });
});

test("the action bar on an assistant reply quotes the whole reply", () => {
  assert.deepEqual(captureFrom({ threadId: "thr_abc", message: message("assistant") }), {
    text: "Burn reports cents. The card sums them.",
    threadId: "thr_abc",
    messageSeq: 41,
  });
});

test("the action bar on a user message opens a blank note", () => {
  assert.equal(captureFrom({ threadId: "thr_abc", message: message("user") }), null);
});
