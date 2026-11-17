import assert from "node:assert/strict";
import { test } from "node:test";
import { COLLAPSED_SECTIONS, HIDDEN_SECTIONS, readSectionSet, withSection, writeSectionSet } from "./section-filter.ts";

const KEY = "bb-plugin-pr-reviews.sidebar.hidden-sections.v1";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

test("nothing stored hides no section", () => {
  assert.deepEqual(readSectionSet(storage(), HIDDEN_SECTIONS), []);
});

test("a written choice reads back", () => {
  const stored = storage();
  writeSectionSet(stored, HIDDEN_SECTIONS, ["review", "merged"]);
  assert.deepEqual(readSectionSet(stored, HIDDEN_SECTIONS), ["review", "merged"]);
});

test("hidden and folded sections are kept apart", () => {
  const stored = storage();
  writeSectionSet(stored, HIDDEN_SECTIONS, ["merged"]);
  writeSectionSet(stored, COLLAPSED_SECTIONS, ["authored"]);
  assert.deepEqual(readSectionSet(stored, HIDDEN_SECTIONS), ["merged"]);
  assert.deepEqual(readSectionSet(stored, COLLAPSED_SECTIONS), ["authored"]);
});

test("reads in sidebar order, dropping unknown keys and repeats", () => {
  assert.deepEqual(readSectionSet(storage({ [KEY]: '["merged","drafts",3,"authored","merged"]' }), HIDDEN_SECTIONS), ["authored", "merged"]);
});

test("corrupt or foreign data hides no section", () => {
  for (const value of ["{not json", '"merged"', '{"hidden":["merged"]}', "null", "42"]) {
    assert.deepEqual(readSectionSet(storage({ [KEY]: value }), HIDDEN_SECTIONS), [], value);
  }
});

test("only this key's data counts", () => {
  assert.deepEqual(readSectionSet(storage({ "bb-plugin-pr-reviews.sidebar.hidden-sections.v0": '["merged"]' }), HIDDEN_SECTIONS), []);
});

test("storage that throws on read hides no section", () => {
  const denied = { ...storage(), getItem: () => { throw new DOMException("Storage access denied", "SecurityError"); } };
  assert.deepEqual(readSectionSet(denied, HIDDEN_SECTIONS), []);
});

test("storage that throws on write warns instead of throwing", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const full = { ...storage(), setItem: () => { throw new DOMException("Storage quota exceeded", "QuotaExceededError"); } };
  writeSectionSet(full, COLLAPSED_SECTIONS, ["merged"]);
  assert.equal(warn.mock.callCount(), 1);
});

test("adding and removing a section keeps sidebar order", () => {
  assert.deepEqual(withSection(["merged"], "authored", true), ["authored", "merged"]);
  assert.deepEqual(withSection(["authored", "merged"], "authored", false), ["merged"]);
  assert.deepEqual(withSection([], "review", false), []);
});
