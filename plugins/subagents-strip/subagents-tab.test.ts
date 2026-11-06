// The Subagents tab's params boundary: what the strip and Open thread write, bb persists as JSON, and the
// tab reads back, on the real fixture's delegates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ExperimentalOpenTabOptions, ExperimentalPanelController, ExperimentalPanelTabs, JsonValue } from "@get-bb/plugin-sdk/app";
import type { EventRow, TimelineRow } from "./bb.ts";
import { foldTaskEvents, normalise } from "./normalise.ts";
import { listShown, openSubagents, openTranscript, parseTabParams, SUBAGENTS_TAB } from "./subagents-tab.ts";

const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
const delegates = normalise(fixture.rows, foldTaskEvents(new Map(), fixture.events), "claude-code");

test("no params, as the launcher row and the strip open it, read as the list", () => {
  const panel = fakePanel();
  openSubagents(panel, "thr_list", null);
  assert.deepEqual(panel.opened.map((o) => [o.tab.id, o.params, o.title]), [["subagents", undefined, "Subagents"]]);
  assert.deepEqual(parseTabParams(null), { kind: "list" });
});

test("Open thread's params read as that delegate's transcript after a round trip through persistence, under its title", () => {
  for (const d of delegates) {
    const panel = fakePanel();
    openTranscript(panel, d.id, d.title);
    const [opened] = panel.opened;
    assert.equal(opened.tab.id, "subagents", "the one tab");
    assert.equal(opened.title, d.title);
    const persisted: JsonValue = JSON.parse(JSON.stringify(opened.params));
    assert.deepEqual(parseTabParams(persisted), { kind: "transcript", delegateId: d.id });
  }
});

test("params of any other shape fall back to the list, never throw", () => {
  const other: JsonValue[] = ["dae8e73ef7-i18", 7, true, [], [{ delegateId: "dae8e73ef7-i18" }], {}, { delegateId: 7 }, { delegateId: "" }, { delegateId: null }];
  for (const params of other) assert.deepEqual(parseTabParams(params), { kind: "list" }, JSON.stringify(params));
});

test("the list reads as shown only while the panel shows the list instance, not a transcript of the same tab", () => {
  const tab = (key: string, params: JsonValue | null) => ({
    key, title: key, status: null, closable: true,
    detail: { kind: "plugin" as const, pluginId: "subagents-strip", tab: SUBAGENTS_TAB, params },
  });
  const tabs = [tab("list", null), tab("transcript", { delegateId: delegates[0].id })];
  const panel = (open: boolean, selectedKey: string): ExperimentalPanelTabs => ({ open, selectedKey, tabs });
  assert.equal(listShown(panel(true, "list")), true);
  assert.equal(listShown(panel(true, "transcript")), false);
  assert.equal(listShown(panel(false, "list")), false, "a closed panel shows nothing");
  const otherPlugin: ExperimentalPanelTabs = { open: true, selectedKey: "x", tabs: [{ ...tab("x", null), detail: { ...tab("x", null).detail, pluginId: "other" } }] };
  assert.equal(listShown(otherPlugin), false);
});

/** A side panel that records what was opened in it. */
function fakePanel(): ExperimentalPanelController & { opened: ExperimentalOpenTabOptions[] } {
  const opened: ExperimentalOpenTabOptions[] = [];
  return {
    opened,
    openTab: (options) => opened.push(options) > 0,
    getTabs: () => ({ open: false, selectedKey: null, tabs: [] }),
    selectTab: () => false,
    closeTab: () => false,
    toggleTab: () => false,
    close: () => false,
  };
}
