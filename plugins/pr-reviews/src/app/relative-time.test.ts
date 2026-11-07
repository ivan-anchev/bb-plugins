import assert from "node:assert/strict";
import { test } from "node:test";
import { timeAgo } from "./relative-time.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");

const cases: [at: string, text: string][] = [
  ["2026-11-06T11:59:40Z", "just now"],
  ["2026-11-06T11:55:00Z", "5m ago"],
  ["2026-11-06T09:00:00Z", "3h ago"],
  ["2026-11-05T12:00:00Z", "yesterday"],
  ["2026-11-02T12:00:00Z", "4d ago"],
  ["2026-10-20T12:00:00Z", "2w ago"],
  ["2026-08-01T12:00:00Z", "3mo ago"],
  ["2024-11-01T12:00:00Z", "2y ago"],
];

for (const [at, text] of cases) {
  test(`timeAgo(${at}) is ${text}`, () => {
    assert.equal(timeAgo(at, NOW), text);
  });
}
