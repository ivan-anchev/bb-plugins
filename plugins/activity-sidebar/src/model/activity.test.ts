import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SleepRecord } from "../contract.ts";
import { buildActivity, type ActivityInput, type SectionKey } from "./activity.ts";
import { project, thread, WORKING } from "./fixtures.ts";

const NOW = 10 * 3_600_000;

function build(threads: PluginSidebarThread[], extra: Partial<ActivityInput> = {}) {
  return buildActivity({ threads, projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), now: NOW, activeThreadId: null, filter: null, ...extra });
}

function ids(sections: ReturnType<typeof build>, key: SectionKey): string[] {
  const section = sections.find((s) => s.key === key);
  assert.ok(section, key);
  return section.rows.map((r) => r.thread.id);
}

test("only parent, visible threads get a row", () => {
  const sections = build([
    thread("parent"),
    thread("child", { parentThreadId: "parent" }),
    thread("helper", { isHidden: true }),
    thread("archived-child", { parentThreadId: "parent", isArchived: true, archivedAt: 1 }),
  ]);
  assert.deepEqual(ids(sections, "activity"), ["parent"]);
  assert.deepEqual(ids(sections, "pinned"), []);
  assert.deepEqual(ids(sections, "archived"), []);
});

test("the sections come in order: Pinned, Activity, then the shelves Working, Asleep, Archived", () => {
  assert.deepEqual(
    build([]).map((s) => s.key),
    ["pinned", "activity", "working", "asleep", "archived"],
  );
});

test("Activity ranks by when each thread last came back, latest first", () => {
  const sections = build([thread("old", { latestAttentionAt: 1_000 }), thread("new", { latestAttentionAt: 3_000 }), thread("mid", { latestAttentionAt: 2_000 })]);
  assert.deepEqual(ids(sections, "activity"), ["new", "mid", "old"]);
});

test("a thread under way leaves Activity for Working, latest first; a pinned one stays pinned", () => {
  const waiting = { indicator: "background-command" } as const;
  const sections = build([
    thread("idle", { latestAttentionAt: 3_000 }),
    thread("busy-old", { latestAttentionAt: 1_000, ...WORKING }),
    thread("busy-new", { latestAttentionAt: 2_000, ...waiting }),
    thread("pinned-busy", { isPinned: true, pinnedAt: 1, ...WORKING }),
    thread("asks", { indicator: "waiting-for-input" }),
  ]);
  assert.deepEqual(ids(sections, "working"), ["busy-new", "busy-old"]);
  assert.deepEqual(ids(sections, "activity"), ["idle", "asks"]);
  assert.deepEqual(ids(sections, "pinned"), ["pinned-busy"]);
});

test("an archived parent sits in Archived, latest archived first, its corner saying when it was archived", () => {
  const sections = build([
    thread("first", { isArchived: true, archivedAt: NOW - 2 * 3_600_000, latestAttentionAt: NOW, ...WORKING }),
    thread("last", { isArchived: true, archivedAt: NOW - 5 * 60_000, isPinned: true, pinnedAt: 1 }),
  ]);
  assert.deepEqual(ids(sections, "archived"), ["last", "first"]);
  assert.deepEqual(ids(sections, "pinned"), []);
  assert.deepEqual(ids(sections, "working"), []);
  assert.deepEqual(
    sections[4].rows.map((r) => r.corner),
    [
      { kind: "time", text: "5m" },
      { kind: "time", text: "2h" },
    ],
  );
});

test("a thread asleep until later sits in Asleep, the soonest to wake first", () => {
  const sleeps = new Map<string, SleepRecord>([
    ["late", { threadId: "late", until: NOW + 7_200_000 }],
    ["soon", { threadId: "soon", until: NOW + 60_000 }],
  ]);
  const sections = build([thread("late", { latestAttentionAt: 9 }), thread("soon", { latestAttentionAt: 1 }), thread("awake")], { sleeps });
  assert.deepEqual(ids(sections, "asleep"), ["soon", "late"]);
  assert.deepEqual(ids(sections, "activity"), ["awake"]);
});

test("the project filter narrows every section to its project", () => {
  const theirs = { projectId: "prj_b" };
  const sections = build(
    [
      thread("mine"),
      thread("theirs", theirs),
      thread("my-pin", { isPinned: true, pinnedAt: 1 }),
      thread("their-pin", { isPinned: true, pinnedAt: 1, ...theirs }),
      thread("my-busy", WORKING),
      thread("their-busy", { ...WORKING, ...theirs }),
      thread("my-old", { isArchived: true, archivedAt: 1 }),
      thread("their-old", { isArchived: true, archivedAt: 1, ...theirs }),
    ],
    { filter: "prj_b" },
  );
  assert.deepEqual(
    sections.map((s) => [s.key, s.rows.map((r) => r.thread.id)]),
    [
      ["pinned", ["their-pin"]],
      ["activity", ["theirs"]],
      ["working", ["their-busy"]],
      ["asleep", []],
      ["archived", ["their-old"]],
    ],
  );
});

test("reading a thread neither moves its row nor resets its time", () => {
  // bb bumps updatedAt (not latestAttentionAt) when a thread is read.
  const sections = build([
    thread("came-back", { latestAttentionAt: NOW - 60_000, updatedAt: NOW - 60_000 }),
    thread("just-read", { latestAttentionAt: NOW - 3 * 60_000, updatedAt: NOW }),
  ]);
  assert.deepEqual(ids(sections, "activity"), ["came-back", "just-read"]);
  assert.deepEqual(sections[1].rows[1].corner, { kind: "time", text: "3m" });
});

test("a thread that woke ranks by when it woke", () => {
  const sleeps = new Map<string, SleepRecord>([["sleeper", { threadId: "sleeper", until: 5_000 }]]);
  const sections = build([thread("sleeper", { latestAttentionAt: 1_000 }), thread("recent", { latestAttentionAt: 4_000 })], { sleeps });
  assert.deepEqual(ids(sections, "activity"), ["sleeper", "recent"]);
});

test("pinned threads leave Activity, latest pin first", () => {
  const sections = build([
    thread("loose", { latestAttentionAt: 9_000 }),
    thread("pin-old", { isPinned: true, pinnedAt: 1_000 }),
    thread("pin-new", { isPinned: true, pinnedAt: 2_000 }),
    thread("pin-same-newer-thread", { isPinned: true, pinnedAt: 1_000, createdAt: 50 }),
  ]);
  assert.deepEqual(ids(sections, "activity"), ["loose"]);
  assert.deepEqual(ids(sections, "pinned"), ["pin-new", "pin-same-newer-thread", "pin-old"]);
});

test("manually ordered pins follow their keys, as bb's list does", () => {
  const sections = build([
    thread("key-c", { isPinned: true, pinnedAt: 3_000, pinSortKey: "c" }),
    thread("key-a", { isPinned: true, pinnedAt: 1_000, pinSortKey: "a" }),
    thread("key-b", { isPinned: true, pinnedAt: 2_000, pinSortKey: "b" }),
  ]);
  assert.deepEqual(ids(sections, "pinned"), ["key-a", "key-b", "key-c"]);
});

test("the corner holds the state, else the time", () => {
  const sections = build([thread("idle", { latestAttentionAt: NOW - 5 * 60_000 }), thread("busy", { latestAttentionAt: NOW, ...WORKING })]);
  const corners = Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.thread.id, r.corner]));
  assert.deepEqual(corners, { busy: { kind: "state", state: "working" }, idle: { kind: "time", text: "5m" } });
});

test("a row is strong with a state or when it is the open thread or holds it", () => {
  const sections = build(
    [
      thread("quiet", { latestAttentionAt: 3 }),
      thread("busy", { latestAttentionAt: 2, ...WORKING }),
      thread("open-parent", { latestAttentionAt: 1 }),
      thread("open-child", { parentThreadId: "open-parent" }),
    ],
    { activeThreadId: "open-child" },
  );
  const rows = Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.thread.id, { strong: r.strong, current: r.current }]));
  assert.deepEqual(rows, {
    quiet: { strong: false, current: false },
    busy: { strong: true, current: false },
    "open-parent": { strong: true, current: true },
  });
});

test("a row carries its project's name and hue, and what runs under it", () => {
  const [, activity] = build([thread("p"), thread("k", { parentThreadId: "p", ...WORKING }), thread("stray", { projectId: "prj_gone" })]);
  assert.equal(activity.key, "activity");
  const byId = Object.fromEntries(activity.rows.map((r) => [r.thread.id, r]));
  assert.equal(byId.p.project.name, "bb-plugins");
  assert.equal(byId.p.runningUnder, 1);
  assert.equal(byId.stray.project.name, "No project");
});
