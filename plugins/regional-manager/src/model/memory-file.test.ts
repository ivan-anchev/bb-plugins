import assert from "node:assert/strict";
import { test } from "node:test";
import { firstLineOf } from "./memory-file.ts";

test("a memory file's first line is its first text that is not a heading, without a list or quote marker", () => {
  assert.equal(firstLineOf("# Plan\n\n1. Inventory the endpoints\n2. Retire cron\n"), "Inventory the endpoints");
  assert.equal(firstLineOf("# Preferences\n\n- 2026-11-20: Rows show only the icon\n"), "2026-11-20: Rows show only the icon");
  assert.equal(firstLineOf("> Quoted\n"), "Quoted");
  assert.equal(firstLineOf("Migrate the webhook service"), "Migrate the webhook service");
});

test("a file of headings only gives its first heading's text, and a blank one gives none", () => {
  assert.equal(firstLineOf("# Crew rules\n\n## Later\n"), "Crew rules");
  assert.equal(firstLineOf("\n  \n"), null);
});
