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
  return { ...set, tabs: set.tabs.map((tab) => (tab.id === set.liveId ? { ...tab, layout } : tab)) };
}
