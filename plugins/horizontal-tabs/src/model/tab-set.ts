// The window's tabs. The live tab is the one whose layout bb shows; every other tab is parked.
// Plain JSON, so it can be saved as is. Pure reducers; the controller owns ids and bb.
import type { Layout } from "./layout.ts";

export type Tab = { id: string; layout: Layout };
/** `tabs` is never empty and `liveId` names one of them. */
export type TabSet = { tabs: readonly Tab[]; liveId: string };

/** One tab, live, holding `layout`. */
export function seed(id: string, layout: Layout): TabSet {
  return { tabs: [{ id, layout }], liveId: id };
}

/** bb's layout becomes the live tab's; parked tabs keep theirs. */
export function adopt(set: TabSet, layout: Layout): TabSet {
  return replace(set, set.liveId, layout);
}

/** `tab` goes right of the live tab, as a browser opens one, and becomes live. */
export function open(set: TabSet, tab: Tab): TabSet {
  const at = indexOf(set, set.liveId) + 1;
  return { tabs: [...set.tabs.slice(0, at), tab, ...set.tabs.slice(at)], liveId: tab.id };
}

/** Tab `id` becomes live, holding `layout` (its own, with pane ids made apart). */
export function makeLive(set: TabSet, id: string, layout: Layout): TabSet {
  return { ...replace(set, id, layout), liveId: id };
}

/** Removes tab `id`; the last tab stays. Closing the live tab hands over to its right neighbour, else its left. */
export function close(set: TabSet, id: string): TabSet {
  if (set.tabs.length === 1) return set;
  const at = indexOf(set, id);
  const tabs = set.tabs.filter((tab) => tab.id !== id);
  return { tabs, liveId: id === set.liveId ? tabs[Math.min(at, tabs.length - 1)].id : set.liveId };
}

/** The tab bb shows. */
export function live(set: TabSet): Tab {
  return tabOf(set, set.liveId);
}

/** Tab `id`, which the set holds. */
export function tabOf(set: TabSet, id: string): Tab {
  return set.tabs[indexOf(set, id)];
}

function indexOf(set: TabSet, id: string): number {
  return set.tabs.findIndex((tab) => tab.id === id);
}

function replace(set: TabSet, id: string, layout: Layout): TabSet {
  return { ...set, tabs: set.tabs.map((tab) => (tab.id === id ? { ...tab, layout } : tab)) };
}
