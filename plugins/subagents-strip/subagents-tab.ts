// The Subagents tab's address, and where it lands. One tab per thread: it is
// opened without params, so opening it again focuses it. A click on a census
// part asks it to land on one delegate; that request is a shared signal, not a
// param, so a jump never opens a second tab.
import type { ExperimentalPanelController, ExperimentalPanelTabs, ExperimentalTabReference } from "@get-bb/plugin-sdk/app";
import type { DelegateId } from "./delegate.ts";
import { threadState, useThreadState } from "./thread-state.ts";

/** The side-panel tab that lists every subagent in the thread. */
export const SUBAGENTS_TAB = {
  id: "subagents",
  context: { kind: "thread" },
  availability: "action",
} as const satisfies ExperimentalTabReference;

/**
 * How many threads keep their Subagents tab state (thread-state.ts): the ones you last clicked in. A
 * handful covers moving between the threads you work across; each entry is a few toggles.
 */
export const KEPT_THREADS = 8;

/** A request to show one delegate, its batch open and its row expanded; each request is a new object. */
export type Landing = { delegateId: DelegateId };

/** Opens, or focuses, the thread's Subagents tab; landing on `at` when given. */
export function openSubagents(panel: ExperimentalPanelController, threadId: string, at: DelegateId | null): void {
  // why: a plain open drops a landing the tab never showed (its row was not there), so it cannot land later.
  landings.set(threadId, at && { delegateId: at });
  panel.openTab({ tab: SUBAGENTS_TAB, title: "Subagents" });
}

/** The thread's latest landing request, live; null when the last open asked for none. */
export function useLanding(threadId: string): Landing | null {
  return useThreadState(landings, threadId);
}

/** Whether the side panel is showing this plugin's Subagents tab. */
export function subagentsTabShown(panel: ExperimentalPanelTabs): boolean {
  const selected = panel.tabs.find((tab) => tab.key === panel.selectedKey);
  return panel.open && selected?.detail.kind === "plugin" && selected.detail.pluginId === PLUGIN_ID && selected.detail.tab.id === SUBAGENTS_TAB.id;
}

// ---------------------------------------------------------------- layer 2

// why: bb derives a plugin's id from its package name (bb-plugin-<id>), and the SDK gives an app no way to read it.
const PLUGIN_ID = "subagents-strip";

// why: the Subagents tab keeps its view for as many threads (ui/SubagentsTab.tsx), so a landing outlives no view.
const landings = threadState<Landing | null>(null, KEPT_THREADS);
