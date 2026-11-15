// The one owner of this window's tabs. bb owns what is on screen: whenever bb's layout or route changes,
// observe copies bb's layout into the live tab, so a focus change, a divider drag or any other way bb
// opens a thread updates the tab with no code of its own.
import type { PluginSidebarProject, PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { focused, single, type Layout } from "../model/layout.ts";
import { adopt, seed, type TabSet } from "../model/tab-set.ts";

/** What the controller needs from bb (host/host-layout.ts; a fake in tests). */
export interface HostLayout {
  /** bb's live layout, or null while bb holds none. */
  read(): Layout | null;
}

/**
 * What the strip renders. `selectedId` is null on routes that show no thread (Settings, plugin pages,
 * bb's New thread). `threads` and `projects` index the sidebar's active threads, for labels and tiles.
 */
export type TabsSnapshot = {
  set: TabSet;
  selectedId: string | null;
  threads: ReadonlyMap<string, PluginSidebarThread>;
  projects: ReadonlyMap<string, PluginSidebarProject>;
};

export function createTabsController(host: HostLayout) {
  let set: TabSet | null = null;
  let selectedId: string | null = null;
  let threads: ReadonlyMap<string, PluginSidebarThread> = new Map();
  let projects: ReadonlyMap<string, PluginSidebarProject> = new Map();
  let snapshot: TabsSnapshot | null = null;
  const listeners = new Set<() => void>();

  function commit(): void {
    if (set === null) return;
    snapshot = { set, selectedId, threads, projects };
    listeners.forEach((listener) => listener());
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Null until the first observe. */
    snapshot: (): TabsSnapshot | null => snapshot,

    /** bb's layout or route changed. `routeThreadId` is the route's thread, null off thread routes. */
    observe(routeThreadId: string | null): void {
      const layout = host.read();
      if (set === null) set = seed(newTabId(), layout ?? single({ kind: "new-thread" }, "pane-1"));
      // why: only a thread in the focused pane is this tab's content. bb's New thread or a plugin page in
      // that pane leaves the tab's layout alone.
      else if (layout !== null && focused(layout).content.kind === "thread") set = adopt(set, layout);
      selectedId = routeThreadId === null ? null : set.liveId;
      commit();
    },

    /** The sidebar's thread index, once it is ready. */
    syncThreads(index: PluginSidebarThreadsState): void {
      threads = new Map(index.threads.map((thread) => [thread.id, thread]));
      projects = new Map(index.projects.map((project) => [project.id, project]));
      commit();
    },
  };
}

function newTabId(): string {
  return `t${Math.random().toString(36).slice(2, 10)}`;
}
