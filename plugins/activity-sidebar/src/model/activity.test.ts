import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SleepRecord } from "../contract.ts";
import { buildActivity, sleepersAskingForYou, type ActivityInput, type ManagerModel, type SectionKey } from "./activity.ts";
import { AVATAR, project, thread, WORKING } from "./fixtures.ts";

const NOW = 10 * 3_600_000;

function model(threads: PluginSidebarThread[], extra: Partial<ActivityInput> = {}) {
  return buildActivity({ threads, projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), held: new Set(), now: NOW, activeThreadId: null, filter: null, looks: [], lines: [], ...extra });
}

function build(threads: PluginSidebarThread[], extra: Partial<ActivityInput> = {}) {
  return model(threads, extra).sections;
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

test("a finished turn waiting on a subthread that reports back stays on Working until the subthread ends", () => {
  const done = { indicator: "unread-success" } as const;
  const sections = build([
    thread("waits", done),
    thread("kid", { parentThreadId: "waits", ...WORKING }),
    thread("waits-deeper"),
    thread("kid-waits", { parentThreadId: "waits-deeper", ...done }),
    thread("grandkid", { parentThreadId: "kid-waits", indicator: "background-agent" }),
    thread("quiet-kid", done),
    thread("silent", { parentThreadId: "quiet-kid", parentNotifications: "stuck", ...WORKING }),
    thread("finished", done),
    thread("kid-done", { parentThreadId: "finished", ...done }),
    thread("asks", { indicator: "waiting-for-input" }),
    thread("kid-of-asks", { parentThreadId: "asks", ...WORKING }),
  ]);
  assert.deepEqual(ids(sections, "working").sort(), ["waits", "waits-deeper"]);
  assert.deepEqual(ids(sections, "activity").sort(), ["asks", "finished", "quiet-kid"], "a silent subthread, a done one, or a question leave it on Activity");
  const corner = sections.flatMap((s) => s.rows).find((r) => r.thread.id === "waits")?.corner;
  assert.deepEqual(corner, { kind: "state", state: "waiting" });
});

test("a held hand-off keeps a settled thread Waiting on Working", () => {
  const sections = build([thread("handing-off", { indicator: "unread-success" }), thread("other", { indicator: "unread-success" })], { held: new Set(["handing-off"]) });
  assert.deepEqual(ids(sections, "working"), ["handing-off"]);
  assert.deepEqual(ids(sections, "activity"), ["other"]);
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
  const sections = build([thread("p"), thread("k", { parentThreadId: "p", ...WORKING }), thread("stray", { projectId: "prj_gone" })]);
  const byId = Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.thread.id, r]));
  assert.equal(byId.p.project.name, "bb-plugins");
  assert.equal(byId.p.runningUnder, 1);
  assert.equal(byId.stray.project.name, "No project");
});

const H = 3_600_000;
const asleep = (id: string, until: number): [string, SleepRecord] => [id, { threadId: id, until }];

test("a sleeper's corner says how soon it wakes, unless its state has more to say", () => {
  const sleeps = new Map([asleep("quiet", NOW + 45 * 60_000), asleep("later", NOW + 3 * H), asleep("busy", NOW + 2 * 24 * H)]);
  const sections = build([thread("quiet"), thread("later"), thread("busy", WORKING)], { sleeps });
  const rows = sections.find((s) => s.key === "asleep")?.rows ?? [];
  assert.deepEqual(
    rows.map((r) => [r.thread.id, r.corner, r.asleepUntil]),
    [
      ["quiet", { kind: "wakes", text: "45m" }, NOW + 45 * 60_000],
      ["later", { kind: "wakes", text: "3h" }, NOW + 3 * H],
      ["busy", { kind: "state", state: "working" }, NOW + 2 * 24 * H],
    ],
  );
});

test("at its time a sleeper comes back to the list, ranked by when it woke, with the Woke glyph", () => {
  const sleeps = new Map([asleep("sleeper", NOW - 60_000)]);
  const sections = build([thread("sleeper", { latestAttentionAt: NOW - 5 * H }), thread("moved", { latestAttentionAt: NOW - 2 * 60_000 })], { sleeps });
  assert.deepEqual(ids(sections, "asleep"), []);
  assert.deepEqual(ids(sections, "activity"), ["sleeper", "moved"]);
  assert.deepEqual(sections[1].rows[0].corner, { kind: "state", state: "woke" });
  assert.equal(sections[1].rows[0].asleepUntil, null);
});

test("a sleeper that asks for you wakes early: back on the list, ranked as woken now, showing what it asks", () => {
  for (const indicator of ["waiting-for-input", "unread-error"] as const) {
    const sleeps = new Map([asleep("asks", NOW + 3 * H)]);
    const sections = build([thread("asks", { indicator, latestAttentionAt: NOW - 5 * H }), thread("moved", { latestAttentionAt: NOW - 60_000 })], { sleeps });
    assert.deepEqual(ids(sections, "asleep"), [], indicator);
    assert.deepEqual(ids(sections, "activity"), ["asks", "moved"], indicator);
    assert.equal(sections[1].rows[0].asleepUntil, null);
  }
});

test("a sleeper that finishes or works stays asleep; only asking for you wakes it", () => {
  const sleeps = new Map([asleep("done", NOW + H), asleep("busy", NOW + 2 * H)]);
  const sections = build([thread("done", { indicator: "unread-success" }), thread("busy", WORKING)], { sleeps });
  assert.deepEqual(ids(sections, "asleep"), ["done", "busy"]);
  assert.deepEqual(ids(sections, "working"), []);
});

test("a pinned or archived thread ignores its sleep: no Asleep, no Woke", () => {
  const sleeps = new Map([asleep("pin-asleep", NOW + H), asleep("pin-woke", NOW - H), asleep("old-woke", NOW - H)]);
  const sections = build(
    [thread("pin-asleep", { isPinned: true, pinnedAt: 2 }), thread("pin-woke", { isPinned: true, pinnedAt: 1 }), thread("old-woke", { isArchived: true, archivedAt: NOW - 60_000 })],
    { sleeps },
  );
  assert.deepEqual(ids(sections, "pinned"), ["pin-asleep", "pin-woke"]);
  assert.deepEqual(ids(sections, "asleep"), []);
  assert.ok(sections.flatMap((s) => s.rows).every((r) => r.corner.kind === "time"));
});

test("the sleepers asking for you are the ones whose sleep ends now, whatever the filter", () => {
  const sleeps = new Map([asleep("asks", NOW + H), asleep("theirs-asks", NOW + H), asleep("quiet", NOW + H), asleep("woke-asks", NOW - H), asleep("pinned-asks", NOW + H)]);
  const asks = { indicator: "waiting-for-input" } as const;
  const threads = [
    thread("asks", asks),
    thread("theirs-asks", { ...asks, projectId: "prj_b" }),
    thread("quiet"),
    thread("woke-asks", asks),
    thread("pinned-asks", { ...asks, isPinned: true, pinnedAt: 1 }),
  ];
  assert.deepEqual(sleepersAskingForYou({ threads, sleeps, now: NOW }), [
    { threadId: "asks", until: NOW + H },
    { threadId: "theirs-asks", until: NOW + H },
  ]);
});

test("a row's detail says its machine and its branch, each when bb names one", () => {
  const env = { id: "env_1", name: "env_1", branchName: "fix/login", path: null, isWorktree: true, providerId: null, workspaceDisplayKind: null };
  const activity = build([
    thread("a", { latestAttentionAt: 2, host: { id: "h", name: "MacBook" }, environment: env }),
    thread("b", { latestAttentionAt: 1 }),
  ]).find((s) => s.key === "activity");
  assert.ok(activity);
  const [placed, bare] = activity.rows.map((r) => r.detail);
  assert.deepEqual(placed, { machine: "MacBook", branch: "fix/login" });
  assert.deepEqual(bare, { machine: null, branch: null });
});

// ------------------------------------------------------------------ regional managers

const MANAGER = { originPluginId: "regional-manager" } as const satisfies Partial<PluginSidebarThread>;

const managerIds = (built: ReturnType<typeof model>): string[] => [...built.managers.pinned, ...built.managers.unpinned].map((m) => m.thread.id);

test("an open regional manager leaves Activity, Working and Asleep, and every other section, for the managers", () => {
  const threads = [
    thread("idle", { ...MANAGER, createdAt: 1, latestAttentionAt: 3 }),
    thread("working", { ...MANAGER, createdAt: 2, ...WORKING }),
    thread("sleeping", { ...MANAGER, createdAt: 3 }),
    thread("pinned", { ...MANAGER, createdAt: 4, isPinned: true, pinnedAt: 1 }),
    thread("plain", { latestAttentionAt: 2 }),
  ];
  const built = model(threads, { sleeps: new Map([["sleeping", { threadId: "sleeping", until: NOW + 3_600_000 }]]) });
  assert.deepEqual(ids(built.sections, "activity"), ["plain"]);
  for (const key of ["pinned", "working", "asleep", "archived"] as const) assert.deepEqual(ids(built.sections, key), [], key);
  assert.deepEqual(managerIds(built), ["pinned", "idle", "working", "sleeping"]);
});

test("pinned managers stand only among the pinned, in bb's pin order; the rest stay oldest first", () => {
  const built = model([
    thread("first-pinned", { ...MANAGER, createdAt: 1, isPinned: true, pinnedAt: 10 }),
    thread("old", { ...MANAGER, createdAt: 2 }),
    thread("latest-pinned", { ...MANAGER, createdAt: 3, isPinned: true, pinnedAt: 30 }),
    thread("middle-pinned", { ...MANAGER, createdAt: 4, isPinned: true, pinnedAt: 20 }),
    thread("new", { ...MANAGER, createdAt: 5 }),
  ]);
  const ids = (managers: readonly ManagerModel[]) => managers.map((m) => m.thread.id);
  assert.deepEqual(ids(built.managers.pinned), ["latest-pinned", "middle-pinned", "first-pinned"], "the latest pin first, as bb orders pins");
  assert.deepEqual(ids(built.managers.unpinned), ["old", "new"]);

  const keyed = model([
    thread("key-b", { ...MANAGER, createdAt: 1, isPinned: true, pinnedAt: 30, pinSortKey: "b" }),
    thread("key-a", { ...MANAGER, createdAt: 2, isPinned: true, pinnedAt: 10, pinSortKey: "a" }),
  ]);
  assert.deepEqual(ids(keyed.managers.pinned), ["key-a", "key-b"], "the user's own order, by its keys");
});

test("an archived regional manager stays an ordinary row on Archived, not among the managers", () => {
  const built = model([thread("open", MANAGER), thread("gone", { ...MANAGER, isArchived: true, archivedAt: 5 })]);
  assert.deepEqual(ids(built.sections, "archived"), ["gone"]);
  assert.deepEqual(managerIds(built), ["open"]);
});

test("only the regional manager's own thread is a manager: its agents are subthreads, and other plugins' threads are threads", () => {
  const built = model([thread("mgr", MANAGER), thread("agent", { ...MANAGER, parentThreadId: "mgr" }), thread("note", { originPluginId: "notes" })]);
  assert.deepEqual(ids(built.sections, "activity"), ["note"]);
  assert.deepEqual(managerIds(built), ["mgr"]);
});

test("managers stand oldest first, whatever they last did, so a new one joins at the end", () => {
  const built = model([
    thread("newest", { ...MANAGER, createdAt: 300, latestAttentionAt: 1 }),
    thread("oldest", { ...MANAGER, createdAt: 100, latestAttentionAt: 3 }),
    thread("middle", { ...MANAGER, createdAt: 200, latestAttentionAt: 2, ...WORKING }),
  ]);
  assert.deepEqual(managerIds(built), ["oldest", "middle", "newest"]);
});

test("the project filter narrows the threads, never the managers", () => {
  const built = model([thread("mgr", { ...MANAGER, projectId: "prj_b" }), thread("a", { projectId: "prj_a" }), thread("b", { projectId: "prj_b" })], { filter: "prj_a" });
  assert.deepEqual(ids(built.sections, "activity"), ["a"]);
  assert.deepEqual(managerIds(built), ["mgr"]);
});

test("a manager shows its look and its line; without them (unread, failed, or none), its name alone with a plain avatar", () => {
  const threads = [thread("known", { ...MANAGER, createdAt: 1, displayTitle: "PR Reviews" }), thread("unknown", { ...MANAGER, createdAt: 2, displayTitle: "Sidebar" })];
  const look = { id: "mgr_1", threadId: "known", description: "Reviews every open pull request.", avatar: AVATAR };
  const lines = [{ threadId: "known", line: "Two pull requests wait on you." }];
  const [known, unknown] = model(threads, { looks: [look], lines, activeThreadId: "unknown" }).managers.unpinned;
  assert.deepEqual({ ...known, thread: known.thread.displayTitle }, { thread: "PR Reviews", look, line: "Two pull requests wait on you.", current: false, state: null, project: "bb-plugins" });
  assert.deepEqual({ ...unknown, thread: unknown.thread.displayTitle }, { thread: "Sidebar", look: null, line: null, current: true, state: null, project: "bb-plugins" });
});

test("a manager's card says its state, as a row would, and its project, or that it has none", () => {
  const [working, elsewhere] = model([thread("working", { ...MANAGER, ...WORKING, createdAt: 1 }), thread("elsewhere", { ...MANAGER, createdAt: 2, projectId: "prj_gone" })]).managers.unpinned;
  assert.deepEqual([working.state, working.project], ["working", "bb-plugins"]);
  assert.deepEqual([elsewhere.state, elsewhere.project], [null, "No project"]);
});

test("with no managers there are none, and the sections are exactly as without them", () => {
  const built = model([thread("a", { latestAttentionAt: 2 }), thread("b", { latestAttentionAt: 1, ...WORKING })]);
  assert.deepEqual(built.managers, { pinned: [], unpinned: [] });
  assert.deepEqual(ids(built.sections, "activity"), ["a"]);
  assert.deepEqual(ids(built.sections, "working"), ["b"]);
});
