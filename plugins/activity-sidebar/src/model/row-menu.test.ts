import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread, PluginThreadActionEntry } from "@get-bb/plugin-sdk/app";
import { buildActivity, type RowModel } from "./activity.ts";
import { project, thread, WORKING } from "./fixtures.ts";
import type { SleepRecord } from "../contract.ts";
import { CORE_KEYS, rowMenu, type MenuAction, type MenuEntry } from "./row-menu.ts";

// why: Sleep's times read the local clock; one zone keeps them the same on every machine.
process.env.TZ = "America/New_York";

/** Thursday 12 November 2026, 2:15 PM in New York. */
const NOW = new Date(2026, 10, 12, 14, 15).getTime();
const HOUR = 3_600_000;

/** The one row a thread makes, as the list builds it, with its sleep if any. */
function rowOf(t: PluginSidebarThread, sleep: SleepRecord | null = null): RowModel {
  const sleeps = new Map(sleep === null ? [] : [[t.id, sleep]]);
  const sections = buildActivity({ threads: [t], projects: [project("prj_a", "bb-plugins")], sleeps, now: NOW, activeThreadId: null, filter: null });
  const row = sections.flatMap((s) => s.rows)[0];
  assert.ok(row);
  return row;
}

/** bb's bound actions for these keys, recording which ran. */
function bound(keys: readonly string[] = CORE_KEYS, ran: string[] = []): PluginThreadActionEntry[] {
  return keys.map((key) => ({
    key,
    pluginId: "bb--core",
    group: "x",
    action: { label: key, icon: "X", variant: key === "bb--core/delete" ? "destructive" : "default", run: async () => void ran.push(key) },
  }));
}

const NO_OWN = { copyId() {}, sleep() {}, wake() {}, sleepCustom() {} };

const SLEEP = "Sleep ▸ In 1 hour · 3:15 PM, In 3 hours · 5:15 PM, This evening · 6:00 PM, Tomorrow · 9:00 AM, Next week · Mon 9:00 AM, —, Custom…";

/** Each entry as its label; a submenu as "Label ▸ [its labels]"; a rule as "—"; a disabled item with its reason. */
function shape(entries: readonly (MenuEntry | MenuAction)[]): string[] {
  return entries.map((e) => {
    if (e.kind === "rule") return "—";
    if (e.kind === "submenu") return `${e.label} ▸ ${shape(e.entries).join(", ")}`;
    return e.disabled ? `${e.label} (${e.why})` : e.label;
  });
}

test("an idle row's menu is Zeron's: Rename, Pin, Copy ▸, Sleep ▸, a rule, Archive, Delete…", () => {
  const menu = rowMenu(rowOf(thread("a")), bound(), NO_OWN, NOW);
  assert.deepEqual(shape(menu.entries), ["Rename", "Pin", "Copy ▸ bb thread link, Thread ID", SLEEP, "—", "Archive", "Delete…"]);
  assert.equal(menu.hoverAction?.label, "Archive");
  assert.equal(menu.hoverAction?.disabled, false);
});

test("a pinned row offers Unpin and no Sleep", () => {
  const menu = rowMenu(rowOf(thread("a", { isPinned: true, pinnedAt: 1 })), bound(), NO_OWN, NOW);
  assert.deepEqual(shape(menu.entries), ["Rename", "Unpin", "Copy ▸ bb thread link, Thread ID", "—", "Archive", "Delete…"]);
});

test("an archived row offers Unarchive, under the pointer too, and no Pin or Sleep", () => {
  const menu = rowMenu(rowOf(thread("a", { isArchived: true, archivedAt: 1 })), bound(), NO_OWN, NOW);
  assert.deepEqual(shape(menu.entries), ["Rename", "Copy ▸ bb thread link, Thread ID", "—", "Unarchive", "Delete…"]);
  assert.equal(menu.hoverAction?.label, "Unarchive");
});

test("while its agent works or waits on background work, the menu's Archive is disabled with Zeron's reason; the corner's is not", () => {
  for (const busy of [WORKING, { indicator: "background-command" } as const]) {
    const menu = rowMenu(rowOf(thread("a", busy)), bound(), NO_OWN, NOW);
    assert.ok(shape(menu.entries).includes("Archive (Stop it first: its agent is still working)"));
    assert.equal(menu.hoverAction?.label, "Archive");
    assert.equal(menu.hoverAction?.disabled, false);
  }
});

test("a row waiting for input, done or connecting can be archived from the menu (Zeron's guard is working or waiting only)", () => {
  const archivable = (t: PluginSidebarThread) => rowMenu(rowOf(t), bound(), NO_OWN, NOW).entries.some((e) => e.kind === "action" && e.label === "Archive" && !e.disabled);
  for (const indicator of ["waiting-for-input", "unread-success"] as const) assert.ok(archivable(thread("a", { indicator })));
  assert.ok(archivable(thread("a", { indicator: "runtime", runtimeStatus: "provisioning" })));
});

test("an action bb doesn't offer drops its entry; with no Archive the corner offers nothing", () => {
  const menu = rowMenu(rowOf(thread("a")), bound(["bb--core/rename", "bb--core/delete"]), NO_OWN, NOW);
  assert.deepEqual(shape(menu.entries), ["Rename", "Copy ▸ Thread ID", SLEEP, "—", "Delete…"]);
  assert.equal(menu.hoverAction, null);
});

test("with neither Archive nor Delete the menu doesn't end on a rule", () => {
  const menu = rowMenu(rowOf(thread("a")), bound(["bb--core/rename"]), NO_OWN, NOW);
  assert.deepEqual(shape(menu.entries), ["Rename", "Copy ▸ Thread ID", SLEEP]);
});

test("each entry runs bb's own bound action; Thread ID and Sleep run the menu's own; Delete… is the danger", () => {
  const ran: string[] = [];
  const own: string[] = [];
  const menu = rowMenu(rowOf(thread("a")), bound(CORE_KEYS, ran), { ...NO_OWN, copyId: () => own.push("copy id"), sleep: (until) => own.push(`sleep ${until}`), sleepCustom: () => own.push("custom") }, NOW);
  for (const e of menu.entries) {
    if (e.kind === "action") e.run();
    if (e.kind === "submenu") e.entries.forEach((c) => c.kind === "action" && c.run());
  }
  assert.deepEqual(ran, ["bb--core/rename", "bb--core/pin", "bb--core/copyLink", "bb--core/archive", "bb--core/delete"]);
  const monday = new Date(2026, 10, 16, 9).getTime();
  const sleeps = [NOW + HOUR, NOW + 3 * HOUR, new Date(2026, 10, 12, 18).getTime(), new Date(2026, 10, 13, 9).getTime(), monday].map((t) => `sleep ${t}`);
  assert.deepEqual(own, ["copy id", ...sleeps, "custom"]);
  const danger = menu.entries.filter((e) => e.kind === "action" && e.danger).map((e) => e.kind === "action" && e.label);
  assert.deepEqual(danger, ["Delete…"]);
});

test("an asleep row offers Wake in Sleep's place, which wakes it", () => {
  let woke = 0;
  const menu = rowMenu(rowOf(thread("a"), { threadId: "a", until: NOW + HOUR }), bound(), { ...NO_OWN, wake: () => woke++ }, NOW);
  assert.deepEqual(shape(menu.entries), ["Rename", "Pin", "Copy ▸ bb thread link, Thread ID", "Wake", "—", "Archive", "Delete…"]);
  menu.entries.forEach((e) => e.kind === "action" && e.label === "Wake" && e.run());
  assert.equal(woke, 1);
});

test("a row that woke, or that woke early asking for you, offers Sleep again", () => {
  const woke = rowMenu(rowOf(thread("a"), { threadId: "a", until: NOW - 1 }), bound(), NO_OWN, NOW);
  const asking = rowMenu(rowOf(thread("a", { indicator: "waiting-for-input" }), { threadId: "a", until: NOW + HOUR }), bound(), NO_OWN, NOW);
  for (const menu of [woke, asking]) assert.equal(shape(menu.entries)[3], SLEEP);
});
