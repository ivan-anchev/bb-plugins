import assert from "node:assert/strict";
import { test } from "node:test";
import { SIDEBAR_WIDTH, clampSidebarWidth, readSidebarWidth, sidebarWidthAfterKey, writeSidebarWidth } from "./sidebar-width.ts";

const KEY = "bb-plugin-pr-reviews.sidebar.width.v1";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

test("keeps a width inside the range, in whole pixels", () => {
  assert.equal(clampSidebarWidth(320), 320);
  assert.equal(clampSidebarWidth(320.6), 321);
});

test("never goes under the minimum or over the maximum", () => {
  assert.equal(clampSidebarWidth(10), SIDEBAR_WIDTH.min);
  assert.equal(clampSidebarWidth(5000), SIDEBAR_WIDTH.max);
});

test("arrows nudge, Home and End jump to the ends, other keys do nothing", () => {
  assert.equal(sidebarWidthAfterKey("ArrowRight", 300), 316);
  assert.equal(sidebarWidthAfterKey("ArrowLeft", 300), 284);
  assert.equal(sidebarWidthAfterKey("ArrowLeft", SIDEBAR_WIDTH.min), SIDEBAR_WIDTH.min);
  assert.equal(sidebarWidthAfterKey("ArrowRight", SIDEBAR_WIDTH.max), SIDEBAR_WIDTH.max);
  assert.equal(sidebarWidthAfterKey("Home", 300), SIDEBAR_WIDTH.min);
  assert.equal(sidebarWidthAfterKey("End", 300), SIDEBAR_WIDTH.max);
  assert.equal(sidebarWidthAfterKey("ArrowDown", 300), null);
});

test("nothing stored gives the default width", () => {
  assert.equal(readSidebarWidth(storage()), SIDEBAR_WIDTH.default);
});

test("a saved width reads back", () => {
  const stored = storage();
  writeSidebarWidth(stored, 400);
  assert.equal(readSidebarWidth(stored), 400);
});

test("a stored width out of range reads clamped", () => {
  assert.equal(readSidebarWidth(storage({ [KEY]: "9000" })), SIDEBAR_WIDTH.max);
  assert.equal(readSidebarWidth(storage({ [KEY]: "12" })), SIDEBAR_WIDTH.min);
});

test("data that is not a number gives the default width", () => {
  for (const value of ["wide", "{}", "NaN", "Infinity"]) {
    assert.equal(readSidebarWidth(storage({ [KEY]: value })), SIDEBAR_WIDTH.default, value);
  }
});

test("storage that throws on read gives the default width", () => {
  const denied = { ...storage(), getItem: () => { throw new DOMException("Storage access denied", "SecurityError"); } };
  assert.equal(readSidebarWidth(denied), SIDEBAR_WIDTH.default);
});

test("storage that throws on write warns instead of throwing", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const full = { ...storage(), setItem: () => { throw new DOMException("Storage quota exceeded", "QuotaExceededError"); } };
  writeSidebarWidth(full, 400);
  assert.equal(warn.mock.callCount(), 1);
});
