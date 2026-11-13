import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread, PluginThreadActionEntry } from "@get-bb/plugin-sdk/app";
import { buildActivity, type RowModel } from "./activity.ts";
import { project, thread, WORKING } from "./fixtures.ts";
import { CORE_KEYS, rowMenu, type MenuEntry } from "./row-menu.ts";

/** The one row a thread makes, as the list builds it. */
function rowOf(t: PluginSidebarThread): RowModel {
  const sections = buildActivity({ threads: [t], projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), now: 0, activeThreadId: null, filter: null });
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

const NO_OWN = { copyId() {} };

/** Each entry as its label; a submenu as "Label ▸ [its labels]"; a rule as "—"; a disabled item with its reason. */
function shape(entries: readonly MenuEntry[]): string[] {
  return entries.map((e) => {
    if (e.kind === "rule") return "—";
    if (e.kind === "submenu") return `${e.label} ▸ ${e.entries.map((c) => c.label).join(", ")}`;
    return e.disabled ? `${e.label} (${e.why})` : e.label;
  });
}

test("an idle row's menu is Zeron's: Rename, Pin, Copy ▸, a rule, Archive, Delete…", () => {
  const menu = rowMenu(rowOf(thread("a")), bound(), NO_OWN);
  assert.deepEqual(shape(menu.entries), ["Rename", "Pin", "Copy ▸ bb thread link, Thread ID", "—", "Archive", "Delete…"]);
  assert.equal(menu.hoverAction?.label, "Archive");
  assert.equal(menu.hoverAction?.disabled, false);
});

test("a pinned row offers Unpin", () => {
  const menu = rowMenu(rowOf(thread("a", { isPinned: true, pinnedAt: 1 })), bound(), NO_OWN);
  assert.equal(shape(menu.entries)[1], "Unpin");
});

test("an archived row offers Unarchive, under the pointer too, and no Pin", () => {
  const menu = rowMenu(rowOf(thread("a", { isArchived: true, archivedAt: 1 })), bound(), NO_OWN);
  assert.deepEqual(shape(menu.entries), ["Rename", "Copy ▸ bb thread link, Thread ID", "—", "Unarchive", "Delete…"]);
  assert.equal(menu.hoverAction?.label, "Unarchive");
});

test("while its agent works or waits on background work, the menu's Archive is disabled with Zeron's reason; the corner's is not", () => {
  for (const busy of [WORKING, { indicator: "background-command" } as const]) {
    const menu = rowMenu(rowOf(thread("a", busy)), bound(), NO_OWN);
    assert.ok(shape(menu.entries).includes("Archive (Stop it first: its agent is still working)"));
    assert.equal(menu.hoverAction?.label, "Archive");
    assert.equal(menu.hoverAction?.disabled, false);
  }
});

test("a row waiting for input, done or connecting can be archived from the menu (Zeron's guard is working or waiting only)", () => {
  const archivable = (t: PluginSidebarThread) => rowMenu(rowOf(t), bound(), NO_OWN).entries.some((e) => e.kind === "action" && e.label === "Archive" && !e.disabled);
  for (const indicator of ["waiting-for-input", "unread-success"] as const) assert.ok(archivable(thread("a", { indicator })));
  assert.ok(archivable(thread("a", { indicator: "runtime", runtimeStatus: "provisioning" })));
});

test("an action bb doesn't offer drops its entry; with no Archive the corner offers nothing", () => {
  const menu = rowMenu(rowOf(thread("a")), bound(["bb--core/rename", "bb--core/delete"]), NO_OWN);
  assert.deepEqual(shape(menu.entries), ["Rename", "Copy ▸ Thread ID", "—", "Delete…"]);
  assert.equal(menu.hoverAction, null);
});

test("with neither Archive nor Delete the menu doesn't end on a rule", () => {
  const menu = rowMenu(rowOf(thread("a")), bound(["bb--core/rename"]), NO_OWN);
  assert.deepEqual(shape(menu.entries), ["Rename", "Copy ▸ Thread ID"]);
});

test("each entry runs bb's own bound action; Thread ID runs the menu's own copy; Delete… is the danger", () => {
  const ran: string[] = [];
  let copied = 0;
  const menu = rowMenu(rowOf(thread("a")), bound(CORE_KEYS, ran), { copyId: () => copied++ });
  for (const e of menu.entries) {
    if (e.kind === "action") e.run();
    if (e.kind === "submenu") e.entries.forEach((c) => c.run());
  }
  assert.deepEqual(ran, ["bb--core/rename", "bb--core/pin", "bb--core/copyLink", "bb--core/archive", "bb--core/delete"]);
  assert.equal(copied, 1);
  const danger = menu.entries.filter((e) => e.kind === "action" && e.danger).map((e) => e.kind === "action" && e.label);
  assert.deepEqual(danger, ["Delete…"]);
});
