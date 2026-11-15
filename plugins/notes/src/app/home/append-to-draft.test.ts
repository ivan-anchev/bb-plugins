import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import type { Brief } from "../../contract.ts";
import { appendToDraft } from "./append-to-draft.ts";

const brief: Brief = {
  text: "Context from 1 note:\n\nsee @Burn card",
  mentions: [{ kind: "thread", threadId: "thr_burn", from: 26, to: 36, label: "Burn card" }],
  attachments: [{ type: "localImage", path: "uploads/chart.png", name: "chart.png", mimeType: "image/png", sizeBytes: 9 }],
};

const empty: ComposerDraftSnapshot = { text: "", mentions: [], attachments: [] };

const pillTexts = ({ text, mentions }: { text: string; mentions: readonly { from: number; to: number }[] }) => mentions.map(({ from, to }) => text.slice(from, to));

test("an empty composer gets the brief as it is", () => {
  assert.deepEqual(appendToDraft(empty, brief), brief);
});

test("the brief goes after what the user typed, which survives", () => {
  const draft = appendToDraft({ ...empty, text: "hello" }, brief);

  assert.equal(draft.text, `hello\n\n${brief.text}`);
  assert.deepEqual(pillTexts(draft), ["@Burn card"]);
});

test("the user's pills and attachments stay, and come first", () => {
  const current: ComposerDraftSnapshot = {
    text: "ask @Spend about this  \n",
    mentions: [{ kind: "thread", threadId: "thr_spend", from: 4, to: 10, label: "Spend" }],
    attachments: [{ type: "localFile", path: "uploads/log.txt", name: "log.txt" }],
  };

  const draft = appendToDraft(current, brief);

  assert.equal(draft.text, `ask @Spend about this\n\n${brief.text}`);
  assert.deepEqual(pillTexts(draft), ["@Spend", "@Burn card"]);
  assert.deepEqual(
    draft.attachments?.map(({ name }) => name),
    ["log.txt", "chart.png"],
  );
});

test("a draft of only an attachment keeps it, and the brief starts the text", () => {
  const current: ComposerDraftSnapshot = { ...empty, text: "\n", attachments: [{ type: "localImage", path: "uploads/a.png", name: "a.png" }] };

  const draft = appendToDraft(current, brief);

  assert.equal(draft.text, brief.text);
  assert.deepEqual(
    draft.attachments?.map(({ name }) => name),
    ["a.png", "chart.png"],
  );
});
