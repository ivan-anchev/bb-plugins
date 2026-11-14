import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActivity } from "../model/activity.ts";
import { project, thread } from "../model/fixtures.ts";
import { listItems } from "./items.ts";

function sections(threads = [thread("a", { latestAttentionAt: 2 }), thread("b", { latestAttentionAt: 1 })]) {
  return buildActivity({ threads, projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), now: 0, activeThreadId: null });
}

test("without pins the list is the Activity title and its rows", () => {
  assert.deepEqual(
    listItems(sections(), "ready").map((i) => i.key),
    ["t:activity", "s:a", "s:b"],
  );
});

test("Pinned stands above Activity only while something is pinned", () => {
  const items = listItems(sections([thread("a"), thread("p", { isPinned: true, pinnedAt: 1 })]), "ready");
  assert.deepEqual(
    items.map((i) => i.key),
    ["t:pinned", "s:p", "t:activity", "s:a"],
  );
});

test("Activity keeps its title when it has no rows", () => {
  assert.deepEqual(
    listItems(sections([]), "ready").map((i) => i.key),
    ["t:activity"],
  );
});

test("loading and error show one notice in place of the rows", () => {
  assert.deepEqual(listItems(sections(), "loading"), [{ kind: "notice", key: "notice", text: "Loading threads…" }]);
  assert.deepEqual(listItems(sections(), "error"), [{ kind: "notice", key: "notice", text: "Couldn't load threads" }]);
});
