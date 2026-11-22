import type { BbNavigate, PluginSidebarProject, PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { focused, single, withFocus, withPaneIdsApart, type Layout } from "../model/layout.ts";
import type { SavedTabs } from "../model/saved.ts";
import { adopt, close, live, locate, makeLive, nth, open, prune, seed, step, tabOf, type TabSet } from "../model/tab-set.ts";

/** The routes the controller takes, from the overlay's useBbNavigate. */
export type Nav = Pick<BbNavigate, "toThread" | "toCompose">;

/** What the controller needs from bb (host/layout/host-layout.ts; a fake in tests). */
export interface HostLayout {
  /** bb's live layout, or null while bb holds none. */
  read(): Layout | null;
  /**
   * bb shows `layout` and routes to its focused pane: at its exact sizes, or, when bb's layout can't be
   * written whole, rebuilt pane by pane at equal sizes. Once `signal` aborts, bb is neither written nor
   * routed and the promise rejects.
   */
  show(layout: Layout, nav: Nav, signal: AbortSignal): Promise<"exact" | "equal-splits">;
}

/**
 * What bb's route shows: a thread; bb's split workspace with no thread in the route (its New thread screen,
 * a plugin page); or a page that takes the workspace's place (Settings).
 */
export type Screen = "thread" | "workspace" | "page";

/** A click on a sidebar thread row the tabs take: a plain click, or a middle-click for a new tab. */
export type SidebarGesture = "plain" | "newTab";

type Binding = { nav: Nav; saved: SavedTabs; signal: AbortSignal };

/**
 * What the strip renders. `selectedId` is null on routes that show no tab (Settings, plugin pages, bb's own
 * New thread). `threads` and `projects` index the sidebar's active threads, for labels and tiles. `notice`:
 * a tab was shown at equal sizes, and the user has not dismissed the notice saying so.
 */
export type TabsSnapshot = {
  set: TabSet;
  selectedId: string | null;
  threads: ReadonlyMap<string, PluginSidebarThread>;
  projects: ReadonlyMap<string, PluginSidebarProject>;
  notice: boolean;
};

export function createTabsController(host: HostLayout) {
  let set: TabSet | null = null;
  let selectedId: string | null = null;
  let threads: ReadonlyMap<string, PluginSidebarThread> = new Map();
  let projects: ReadonlyMap<string, PluginSidebarProject> = new Map();
  let snapshot: TabsSnapshot | null = null;
  let binding: Binding | null = null;
  let screen: Screen = "page";
  let wanted: Layout | null = null;
  let showing = false;
  let notice: "unraised" | "raised" | "dismissed" = "unraised";
  const listeners = new Set<() => void>();

  function commit(): void {
    if (set === null) return;
    snapshot = { set, selectedId, threads, projects, notice: notice === "raised" };
    binding?.saved.save(set);
    listeners.forEach((listener) => listener());
  }

  function observe(shown: Screen): void {
    screen = shown;
    if (showing) return;
    const layout = host.read();
    const kind = layout === null ? null : focused(layout).content.kind;
    set = set === null ? seed(newTabId(), layout ?? single({ kind: "new-thread" }, "pane-1")) : adoptThread(set, layout);
    const ownNewThread =
      shown === "workspace" && kind === "new-thread" && focused(live(set).layout).content.kind === "new-thread";
    selectedId = shown === "thread" || ownNewThread ? set.liveId : null;
    commit();
  }

  function activate(id: string): void {
    if (set === null || id === selectedId) return;
    const current = caughtUp(set);
    present(current, id, id === current.liveId ? null : live(current).layout);
  }

  function switchToThread(current: TabSet, threadId: string): boolean {
    const hit = locate(current, threadId);
    if (hit === undefined || hit.tab.id === current.liveId) return false;
    const { tab, pane } = hit;
    present(makeLive(current, tab.id, withFocus(tab.layout, pane.paneId)), tab.id, live(current).layout);
    return true;
  }

  function openThreadTab(current: TabSet, threadId: string): boolean {
    const thread = threads.get(threadId);
    if (thread === undefined) return false;
    const id = newTabId();
    const layout = single({ kind: "thread", projectId: thread.projectId, threadId }, `${id}-1`);
    present(open(current, { id, layout }), id, live(current).layout);
    return true;
  }

  function caughtUp(current: TabSet): TabSet {
    return showing ? current : adoptThread(current, host.read());
  }

  function present(next: TabSet, id: string, outgoing: Layout | null): void {
    const layout = withPaneIdsApart(tabOf(next, id).layout, outgoing, id);
    set = makeLive(next, id, layout);
    selectedId = id;
    commit();
    wanted = layout;
    if (!showing) void pump();
  }

  async function pump(): Promise<void> {
    showing = true;
    while (wanted !== null && binding !== null) {
      const next = wanted;
      wanted = null;
      await show(next, binding);
    }
    showing = false;
    if (binding !== null) observe(screen);
  }

  async function show(layout: Layout, { nav, signal }: Binding): Promise<void> {
    try {
      const shown = await host.show(layout, nav, signal);
      if (shown === "equal-splits" && notice === "unraised") {
        notice = "raised";
        commit();
      }
    } catch (error) {
      if (signal.aborted) return;
      wanted = null;
      console.warn("[horizontal-tabs] could not show the tab's layout:", error);
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    snapshot: (): TabsSnapshot | null => snapshot,

    bind(nav: Nav, saved: SavedTabs): () => void {
      set ??= saved.load();
      const abort = new AbortController();
      binding = { nav, saved, signal: abort.signal };
      return () => {
        abort.abort();
        binding = null;
        wanted = null;
      };
    },

    observe,

    syncThreads(index: PluginSidebarThreadsState): void {
      threads = new Map(index.threads.map((thread) => [thread.id, thread]));
      projects = new Map(index.projects.map((project) => [project.id, project]));
      if (set !== null) set = prune(set, (threadId) => threads.has(threadId));
      commit();
    },

    activate,

    step(delta: 1 | -1): void {
      if (set !== null) activate(step(set, selectedId ?? set.liveId, delta).id);
    },

    goTo(n: number): void {
      const tab = set === null ? undefined : nth(set, n);
      if (tab !== undefined) activate(tab.id);
    },

    canStep: (): boolean => set !== null && set.tabs.length > 1,

    has: (n: number): boolean => set !== null && nth(set, n) !== undefined,

    close(id: string): void {
      if (set === null) return;
      const rest = close(set, id);
      if (rest.liveId === set.liveId) {
        set = rest;
        commit();
      } else present(rest, rest.liveId, live(set).layout);
    },

    routeSidebarClick(threadId: string, gesture: SidebarGesture): boolean {
      if (set === null) return false;
      const current = caughtUp(set);
      return gesture === "newTab" ? openThreadTab(current, threadId) : switchToThread(current, threadId);
    },

    dismissNotice(): void {
      notice = "dismissed";
      commit();
    },

    openNew(): void {
      if (set === null) return;
      const current = caughtUp(set);
      const id = newTabId();
      present(open(current, { id, layout: single({ kind: "new-thread" }, `${id}-1`) }), id, live(current).layout);
    },
  };
}

function adoptThread(set: TabSet, layout: Layout | null): TabSet {
  return layout !== null && focused(layout).content.kind === "thread" ? adopt(set, layout) : set;
}

function newTabId(): string {
  return `t${Math.random().toString(36).slice(2, 10)}`;
}
