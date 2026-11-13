import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFilter, parseOpen } from "./choices.ts";
import { readChoice, writeChoice, type ChoiceStorage } from "./use-local-choice.ts";

function memory(): ChoiceStorage & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return { saved, getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => void saved.set(key, value) };
}

const denied: ChoiceStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

test("a choice written comes back as it was", () => {
  const storage = memory();
  writeChoice(storage, "activity-sidebar.open-sections", ["activity", "archived"]);
  writeChoice(storage, "activity-sidebar.project-filter", "prj_b");
  assert.deepEqual(readChoice(storage, "activity-sidebar.open-sections", parseOpen), ["activity", "archived"]);
  assert.equal(readChoice(storage, "activity-sidebar.project-filter", parseFilter), "prj_b");

  writeChoice(storage, "activity-sidebar.project-filter", null);
  assert.equal(readChoice(storage, "activity-sidebar.project-filter", parseFilter), null);
});

test("with nothing stored, Pinned and Activity are open, the shelves folded, and no filter", () => {
  assert.deepEqual(readChoice(memory(), "k", parseOpen), ["pinned", "activity"]);
  assert.equal(readChoice(memory(), "k", parseFilter), null);
});

test("an empty open list stays empty: every section folded is a choice too", () => {
  const storage = memory();
  writeChoice(storage, "k", []);
  assert.deepEqual(readChoice(storage, "k", parseOpen), []);
});

test("unreadable or foreign values read as the default; unknown section keys are dropped", () => {
  const storage = memory();
  storage.saved.set("broken", "{not json");
  storage.saved.set("foreign", JSON.stringify(["archived", "projects", 7]));
  storage.saved.set("number", "42");
  assert.deepEqual(readChoice(storage, "broken", parseOpen), ["pinned", "activity"]);
  assert.deepEqual(readChoice(storage, "foreign", parseOpen), ["archived"]);
  assert.equal(readChoice(storage, "number", parseFilter), null);
});

test("storage the browser denies reads as nothing stored and only warns on save", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.deepEqual(readChoice(denied, "k", parseOpen), ["pinned", "activity"]);
  writeChoice(denied, "k", ["activity"]);
  assert.equal(warn.mock.callCount(), 1);
});
