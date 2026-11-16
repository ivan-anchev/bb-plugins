// The window's tabs. The live tab is the one whose layout bb shows; every other tab is parked.
// Plain JSON, so it can be saved as is. Pure reducers; the controller owns ids and bb.
import { panes, withoutThreads, type Layout, type Pane } from "./layout.ts";

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

/** The tab `delta` places from tab `id`, wrapping past either end. */
export function step(set: TabSet, id: string, delta: number): Tab {
  const count = set.tabs.length;
  return set.tabs[(((indexOf(set, id) + delta) % count) + count) % count];
}

/** Tab `n`, counting from 1; undefined past the last tab. */
export function nth(set: TabSet, n: number): Tab | undefined {
  return set.tabs[n - 1];
}

/**
 * The tab and pane showing thread `threadId`: the live tab's first, else the leftmost tab's. Undefined when
 * no tab shows it.
 */
export function locate(set: TabSet, threadId: string): { tab: Tab; pane: Pane } | undefined {
  for (const tab of [live(set), ...set.tabs]) {
    const pane = panes(tab.layout).find(({ content }) => content.kind === "thread" && content.threadId === threadId);
    if (pane !== undefined) return { tab, pane };
  }
  return undefined;
}

/**
 * Parked tabs lose their panes on threads `alive` rejects, and a tab left with none goes. The live tab is
 * left to bb, which closes those panes itself.
 */
export function prune(set: TabSet, alive: (threadId: string) => boolean): TabSet {
  const tabs = set.tabs.flatMap((tab) => {
    if (tab.id === set.liveId) return [tab];
    const layout = withoutThreads(tab.layout, alive);
    return layout === null ? [] : [{ ...tab, layout }];
  });
  return { ...set, tabs };
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
