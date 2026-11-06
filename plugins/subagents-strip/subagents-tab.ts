// The Subagents tab's address: one registration, two kinds of instance. With
// no params it is the thread's list of every subagent, one per thread, so
// opening it again focuses it. With a delegate's id it is that delegate's
// transcript, one per delegate, which Open thread opens. bb persists the
// params as JSON and hands them back; they are parsed here, once. A click on a
// census part asks the list to land on one delegate; that request is a shared
// signal, not a param, so a jump never opens a second list.
import type { ExperimentalPanelController, ExperimentalPanelTabs, ExperimentalTabReference, JsonValue } from "@get-bb/plugin-sdk/app";
import type { DelegateId } from "./delegate.ts";
import { threadState, useThreadState } from "./thread-state.ts";

/** The side-panel tab: the thread's subagents, or one subagent's transcript. Equal params focus the open instance. */
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

/** What one instance of the tab shows, as its params name it. */
type TabParams = { kind: "list" } | { kind: "transcript"; delegateId: DelegateId };

/** An instance's persisted params, read once: a delegate's id names its transcript; anything else is the list. */
export function parseTabParams(params: JsonValue | null): TabParams {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return LIST;
  const { delegateId } = params;
  // why: bb returns the params openTranscript wrote, so a non-empty string here is a delegate's id.
  return typeof delegateId === "string" && delegateId !== "" ? { kind: "transcript", delegateId: delegateId as DelegateId } : LIST;
}

/** Opens, or focuses, the thread's list; landing on `at` when given. */
export function openSubagents(panel: ExperimentalPanelController, threadId: string, at: DelegateId | null): void {
  // why: a plain open drops a landing the list never showed (its row was not there), so it cannot land later.
  landings.set(threadId, at && { delegateId: at });
  panel.openTab({ tab: SUBAGENTS_TAB, title: "Subagents" });
}

/** Opens, or focuses, one delegate's transcript, titled with the delegate's own title. */
export function openTranscript(panel: ExperimentalPanelController, delegateId: DelegateId, title: string): void {
  panel.openTab({ tab: SUBAGENTS_TAB, params: { delegateId }, title });
}

/** The thread's latest landing request, live; null when the last open asked for none. */
export function useLanding(threadId: string): Landing | null {
  return useThreadState(landings, threadId);
}

/** Whether the side panel is showing the list instance, not a transcript. */
export function listShown(panel: ExperimentalPanelTabs): boolean {
  const selected = panel.tabs.find((tab) => tab.key === panel.selectedKey);
  if (!panel.open || selected?.detail.kind !== "plugin") return false;
  const { pluginId, tab, params } = selected.detail;
  return pluginId === PLUGIN_ID && tab.id === SUBAGENTS_TAB.id && parseTabParams(params).kind === "list";
}

// ---------------------------------------------------------------- layer 2

// why: bb derives a plugin's id from its package name (bb-plugin-<id>), and the SDK gives an app no way to read it.
const PLUGIN_ID = "subagents-strip";

const LIST: TabParams = { kind: "list" };

// why: the Subagents tab keeps its view for as many threads (ui/SubagentsTab.tsx), so a landing outlives no view.
const landings = threadState<Landing | null>(null, KEPT_THREADS);
