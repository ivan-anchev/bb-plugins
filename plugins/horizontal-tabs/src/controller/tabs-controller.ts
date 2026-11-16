// The one owner of this window's tabs. bb owns what is on screen: whenever bb's layout or route changes,
// observe copies bb's layout into the live tab, so a focus change, a divider drag or any other way bb
// opens a thread updates the tab with no code of its own. The plugin writes bb's layout only when the user
// changes tabs, one write at a time.
import type { BbNavigate, PluginSidebarProject, PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { focused, single, withPaneIdsApart, type Layout } from "../model/layout.ts";
import { adopt, close, live, makeLive, open, seed, tabOf, type TabSet } from "../model/tab-set.ts";

/** The routes the controller takes, from the overlay's useBbNavigate. */
export type Nav = Pick<BbNavigate, "toThread" | "toCompose">;

/** What the controller needs from bb (host/host-layout.ts; a fake in tests). */
export interface HostLayout {
  /** bb's live layout, or null while bb holds none. */
  read(): Layout | null;
  /**
   * bb shows `layout` and routes to its focused pane. Once `signal` aborts, bb is neither written nor routed
   * and the promise rejects.
   */
  show(layout: Layout, nav: Nav, signal: AbortSignal): Promise<void>;
}

/**
 * What bb's route shows: a thread; bb's split workspace with no thread in the route (its New thread screen,
 * a plugin page); or a page that takes the workspace's place (Settings).
 */
export type Screen = "thread" | "workspace" | "page";

/** The overlay's navigator, and the signal its unbind aborts. */
type Binding = { nav: Nav; signal: AbortSignal };

/**
 * What the strip renders. `selectedId` is null on routes that show no tab (Settings, plugin pages, bb's own
 * New thread). `threads` and `projects` index the sidebar's active threads, for labels and tiles.
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
  /** From bind until its unbind. */
  let binding: Binding | null = null;
  /** What bb's route shows, as last observed. */
  let screen: Screen = "page";
  /** The layout the user last asked bb to show, not yet written. */
  let wanted: Layout | null = null;
  /** A write is in flight. */
  let showing = false;
  const listeners = new Set<() => void>();

  function commit(): void {
    if (set === null) return;
    snapshot = { set, selectedId, threads, projects };
    listeners.forEach((listener) => listener());
  }

  /** bb's layout or route changed; `shown` is what the route shows now. */
  function observe(shown: Screen): void {
    screen = shown;
    // why: bb is still taking the layout being written and routing to it; the pump observes once it is done.
    if (showing) return;
    const layout = host.read();
    const kind = layout === null ? null : focused(layout).content.kind;
    if (set === null) set = seed(newTabId(), layout ?? single({ kind: "new-thread" }, "pane-1"));
    // why: only a thread in the focused pane is this tab's content. bb's New thread or a plugin page in
    // that pane leaves the tab's layout alone, so clicking the tab brings it back.
    else if (layout !== null && kind === "thread") set = adopt(set, layout);
    // A `+` tab is selected on its own New thread screen; bb's New thread button over a thread selects none,
    // and neither does Settings, though bb keeps the `+` tab's New thread pane underneath.
    const ownNewThread =
      shown === "workspace" && kind === "new-thread" && focused(live(set).layout).content.kind === "new-thread";
    selectedId = shown === "thread" || ownNewThread ? set.liveId : null;
    commit();
  }

  /**
   * Makes tab `id` of `next` live and has bb show it. `outgoing` is the layout bb shows now, whose pane ids
   * the tab must not reuse; null when bb shows this tab already.
   */
  function present(next: TabSet, id: string, outgoing: Layout | null): void {
    const layout = withPaneIdsApart(tabOf(next, id).layout, outgoing, id);
    set = makeLive(next, id, layout);
    selectedId = id;
    commit();
    wanted = layout;
    if (!showing) void pump();
  }

  // why: quick switches must not interleave bb's writes and routes. One write at a time; switches made
  // meanwhile only replace `wanted`, so the last one wins and the ones between are skipped. Unbinding stops
  // the loop: the write in flight aborts and nothing more is written.
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
      await host.show(layout, nav, signal);
    } catch (error) {
      if (signal.aborted) return;
      // why: issue 06 replaces this with a pane-by-pane fallback; until then the tab adopts what bb shows.
      wanted = null;
      console.warn("[horizontal-tabs] could not show the tab's layout:", error);
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Null until the first observe. */
    snapshot: (): TabsSnapshot | null => snapshot,

    /**
     * The navigator tab switches route with; the overlay binds it before its first observe, and unbinds it
     * when it unmounts. After the unbind bb is neither written nor routed, even by a write in flight.
     */
    bind(nav: Nav): () => void {
      const abort = new AbortController();
      binding = { nav, signal: abort.signal };
      return () => {
        abort.abort();
        binding = null;
        wanted = null;
      };
    },

    observe,

    /** The sidebar's thread index, once it is ready. */
    syncThreads(index: PluginSidebarThreadsState): void {
      threads = new Map(index.threads.map((thread) => [thread.id, thread]));
      projects = new Map(index.projects.map((project) => [project.id, project]));
      commit();
    },

    /** A tab click: bb shows its layout. From Settings or a plugin page this also brings back the live tab. */
    activate(id: string): void {
      if (set === null || id === selectedId) return;
      present(set, id, id === set.liveId ? null : live(set).layout);
    },

    /** Closes tab `id`; the last tab stays. Closing the live tab shows its right neighbour, else its left. */
    close(id: string): void {
      if (set === null) return;
      const rest = close(set, id);
      if (rest.liveId === set.liveId) {
        set = rest;
        commit();
      } else present(rest, rest.liveId, live(set).layout);
    },

    /** `+`: a tab right of the live one, on the New thread screen; the thread created there fills it. */
    openNew(): void {
      if (set === null) return;
      const id = newTabId();
      present(open(set, { id, layout: single({ kind: "new-thread" }, `${id}-1`) }), id, live(set).layout);
    },
  };
}

function newTabId(): string {
  return `t${Math.random().toString(36).slice(2, 10)}`;
}
