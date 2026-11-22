import assert from "node:assert/strict";
import { test } from "node:test";
import { previewOf } from "./memory-file.ts";

test("a memory file's preview is its text as it starts, up to 2,000 characters", () => {
  assert.equal(previewOf("# Plan\n\n1. Inventory the endpoints\n"), "# Plan\n\n1. Inventory the endpoints\n");
  assert.equal(previewOf(""), "");
  const long = `# Notes\n\n${"x".repeat(5_000)}`;
  assert.equal(previewOf(long), long.slice(0, 2_000));
});
