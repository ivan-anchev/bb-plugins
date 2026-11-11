import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteReplyText } from "./thread-schema.ts";

test("a quote reply puts each line behind > , a blank line as a bare >, then leaves a blank line to write on", () => {
  assert.equal(quoteReplyText("Why halve it?\n\nPRs past the **100th** drop out.\n"), "> Why halve it?\n>\n> PRs past the **100th** drop out.\n\n");
});

test("a fenced block stays fenced inside the quote", () => {
  assert.equal(quoteReplyText("```ts\nconst a = 1;\n```"), "> ```ts\n> const a = 1;\n> ```\n\n");
});
