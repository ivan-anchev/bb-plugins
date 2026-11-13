import assert from "node:assert/strict";
import { test } from "node:test";
import { experimental_PluginRpcCallError, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { buildActivity, type SectionKey } from "../model/activity.ts";
import { project, thread, WORKING } from "../model/fixtures.ts";
import { LOADED, view } from "./fixtures.ts";
import { listItems, sleepsStatus, type ListItem } from "./items.ts";

function sections(threads = [thread("a", { latestAttentionAt: 2 }), thread("b", { latestAttentionAt: 1 })]) {
  return buildActivity({ threads, projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), now: 0, activeThreadId: null, filter: null }).sections;
}

/** n archived parents, the latest archived first: x0, x1, … */
function archived(n: number): PluginSidebarThread[] {
  return Array.from({ length: n }, (_, i) => thread(`x${i}`, { isArchived: true, archivedAt: n - i }));
}

const keys = (items: readonly ListItem[]) => items.map((i) => i.key);
const titles = (items: readonly ListItem[]) => items.filter((i) => i.kind === "title").map((i) => [i.label, i.count]);
const open = (...keys: SectionKey[]) => new Set(keys);

test("without pins or shelves the list is the Activity title and its rows, with no spacer", () => {
  assert.deepEqual(keys(listItems(sections(), view())), ["t:activity", "s:a", "s:b"]);
});

test("Pinned stands above Activity only while something is pinned", () => {
  const items = listItems(sections([thread("a"), thread("p", { isPinned: true, pinnedAt: 1 })]), view());
  assert.deepEqual(keys(items), ["t:pinned", "s:p", "t:activity", "s:a"]);
});

test("Activity keeps its title when it has no rows", () => {
  assert.deepEqual(keys(listItems(sections([]), view())), ["t:activity"]);
});

test("the shelves stand after a spacer, Working then Archived; an empty shelf is left out", () => {
  const items = listItems(sections([thread("idle"), thread("busy", WORKING), ...archived(1)]), view());
  assert.deepEqual(keys(items), ["t:activity", "s:idle", "spacer", "t:working", "s:busy", "t:archived", "s:x0"]);
});

test("a folded section is its title with its count; open, its title says no count", () => {
  const items = listItems(sections([thread("idle"), thread("busy", WORKING), thread("busy2", WORKING), ...archived(3)]), view({ open: open("activity") }));
  assert.deepEqual(keys(items), ["t:activity", "s:idle", "spacer", "t:working", "t:archived"]);
  assert.deepEqual(titles(items), [
    ["Activity", null],
    ["Working", "2"],
    ["Archived", "3"],
  ]);
  assert.deepEqual(
    items.filter((i) => i.kind === "title").map((i) => i.open),
    [true, false, false],
  );
});

test("Archived counts n+ while the server holds more pages, and stands before any page has loaded", () => {
  const more = { ...LOADED, hasNextPage: true };
  assert.deepEqual(titles(listItems(sections(archived(50)), view({ open: open(), archive: more }))), [
    ["Activity", "0"],
    ["Archived", "50+"],
  ]);
  assert.deepEqual(keys(listItems(sections([]), view({ open: open(), archive: more }))), ["t:activity", "spacer", "t:archived"]);
});

test("open, Archived shows 10, then offers the next 25 already loaded", () => {
  const items = listItems(sections(archived(40)), view());
  const rows = items.filter((i) => i.kind === "row");
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0].key, "s:x0");
  assert.deepEqual(items.at(-1), { kind: "more", key: "more:archived", n: 25 });
});

test("Show more says how many are left when the server has no more, and nothing once all show", () => {
  assert.deepEqual(listItems(sections(archived(22)), view()).at(-1), { kind: "more", key: "more:archived", n: 12 });
  assert.equal(listItems(sections(archived(22)), view({ archivedShown: 35 })).at(-1)?.key, "s:x21");
});

test("Show more names no number when only the server knows how many remain", () => {
  const items = listItems(sections(archived(12)), view({ archive: { ...LOADED, hasNextPage: true } }));
  assert.deepEqual(items.at(-1), { kind: "more", key: "more:archived", n: null });
});

test("a page on its way shows Loading in place of Show more", () => {
  const items = listItems(sections(archived(12)), view({ archivedShown: 35, archive: { ...LOADED, hasNextPage: true, isFetchingNextPage: true } }));
  assert.deepEqual(items.at(-1), { kind: "notice", key: "n:archived", text: "Loading…", retry: false });
});

test("a failed archived page, or a failed first page, says so with Retry", () => {
  const failed: ListItem = { kind: "notice", key: "n:archived", text: "Couldn't load archived threads", retry: true };
  const pageFailed = listItems(sections(archived(12)), view({ archivedShown: 35, archive: { ...LOADED, hasNextPage: true, isFetchNextPageError: true } }));
  assert.deepEqual(pageFailed.at(-1), failed);
  const firstFailed = listItems(sections([]), view({ archive: { ...LOADED, status: "error" } }));
  assert.deepEqual(keys(firstFailed), ["t:activity", "spacer", "t:archived", "n:archived"]);
  assert.deepEqual(firstFailed.at(-1), failed);
});

test("the filter names its project in Activity's title", () => {
  assert.deepEqual(titles(listItems(sections(), view({ filterName: "cherubot" }))), [["Activity · cherubot", null]]);
});

test("loading and error show one notice in place of the rows", () => {
  assert.deepEqual(listItems(sections(), view({ status: "loading" })), [{ kind: "notice", key: "n:list", text: "Loading threads…", retry: false }]);
  assert.deepEqual(listItems(sections(), view({ status: "error" })), [{ kind: "notice", key: "n:list", text: "Couldn't load threads", retry: false }]);
});

test("until the sleeps are read the list says Loading, so no sleeper flashes in Activity", () => {
  assert.deepEqual(listItems(sections(), view({ sleeps: "loading" })), [{ kind: "notice", key: "n:list", text: "Loading threads…", retry: false }]);
  assert.deepEqual(listItems(sections(), view({ status: "loading", sleeps: "ready" })), [{ kind: "notice", key: "n:list", text: "Loading threads…", retry: false }]);
});

test("sleeps that failed to load leave the rows and a notice with Retry above them", () => {
  const items = listItems(sections(), view({ sleeps: "error" }));
  assert.deepEqual(items[0], { kind: "notice", key: "n:sleeps", text: "Couldn't load sleep times", retry: true });
  assert.deepEqual(keys(items), ["n:sleeps", "t:activity", "s:a", "s:b"]);
});

test("a refresh of the sleeps that fails after one that loaded keeps their shelf and says so, with Retry", () => {
  const retained = { sleeps: [{ threadId: "b", until: 5 }] };
  const failed = new experimental_PluginRpcCallError({ code: "transport_error", message: "Failed to fetch" });
  assert.equal(sleepsStatus({ data: undefined, error: null }), "loading");
  assert.equal(sleepsStatus({ data: retained, error: null }), "ready");
  assert.equal(sleepsStatus({ data: retained, error: failed }), "error");

  const asleep = buildActivity({ threads: [thread("a"), thread("b")], projects: [project("prj_a", "bb-plugins")], sleeps: new Map([["b", retained.sleeps[0]]]), now: 0, activeThreadId: null, filter: null }).sections;
  const items = listItems(asleep, view({ sleeps: sleepsStatus({ data: retained, error: failed }), open: open("activity", "asleep") }));
  assert.deepEqual(keys(items), ["n:sleeps", "t:activity", "s:a", "spacer", "t:asleep", "s:b"]);
  assert.deepEqual(items[0], { kind: "notice", key: "n:sleeps", text: "Couldn't load sleep times", retry: true });
});

test("Asleep stands between Working and Archived while something sleeps", () => {
  const threads = [thread("a"), thread("busy", WORKING), thread("zz"), thread("old", { isArchived: true, archivedAt: 1 })];
  const built = buildActivity({ threads, projects: [project("prj_a", "bb-plugins")], sleeps: new Map([["zz", { threadId: "zz", until: 5 }]]), now: 0, activeThreadId: null, filter: null }).sections;
  assert.deepEqual(keys(listItems(built, view({ open: open("activity") }))), ["t:activity", "s:a", "spacer", "t:working", "t:asleep", "t:archived"]);
  assert.deepEqual(titles(listItems(built, view({ open: open() }))).slice(-2), [["Asleep", "1"], ["Archived", "1"]]);
});

test("a row item says which section it stands in", () => {
  const items = listItems(sections([thread("idle"), thread("busy", WORKING)]), view());
  assert.deepEqual(
    items.flatMap((i) => (i.kind === "row" ? [[i.row.thread.id, i.section]] : [])),
    [["idle", "activity"], ["busy", "working"]],
  );
});
