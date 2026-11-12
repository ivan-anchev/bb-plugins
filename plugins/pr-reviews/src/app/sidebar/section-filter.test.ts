import assert from "node:assert/strict";
import { test } from "node:test";
import { readHiddenSections, withSectionShown, writeHiddenSections } from "./section-filter.ts";

const KEY = "bb-plugin-pr-reviews.sidebar.hidden-sections.v1";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

test("nothing stored hides no section", () => {
  assert.deepEqual(readHiddenSections(storage()), []);
});

test("a written choice reads back", () => {
  const stored = storage();
  writeHiddenSections(stored, ["review", "merged"]);
  assert.deepEqual(readHiddenSections(stored), ["review", "merged"]);
});

test("reads in sidebar order, dropping unknown keys and repeats", () => {
  assert.deepEqual(readHiddenSections(storage({ [KEY]: '["merged","drafts",3,"authored","merged"]' })), ["authored", "merged"]);
});

test("corrupt or foreign data hides no section", () => {
  for (const value of ["{not json", '"merged"', '{"hidden":["merged"]}', "null", "42"]) {
    assert.deepEqual(readHiddenSections(storage({ [KEY]: value })), [], value);
  }
});

test("only this key's data counts", () => {
  assert.deepEqual(readHiddenSections(storage({ "bb-plugin-pr-reviews.sidebar.hidden-sections.v0": '["merged"]' })), []);
});

test("storage that throws on read hides no section", () => {
  const denied = { ...storage(), getItem: () => { throw new DOMException("Storage access denied", "SecurityError"); } };
  assert.deepEqual(readHiddenSections(denied), []);
});

test("storage that throws on write warns instead of throwing", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const full = { ...storage(), setItem: () => { throw new DOMException("Storage quota exceeded", "QuotaExceededError"); } };
  writeHiddenSections(full, ["merged"]);
  assert.equal(warn.mock.callCount(), 1);
});

test("hiding and showing a section keeps sidebar order", () => {
  assert.deepEqual(withSectionShown(["merged"], "authored", false), ["authored", "merged"]);
  assert.deepEqual(withSectionShown(["authored", "merged"], "authored", true), ["merged"]);
  assert.deepEqual(withSectionShown([], "review", true), []);
});
