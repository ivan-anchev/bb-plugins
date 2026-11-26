// What the sidebar shows: with regional managers, a control row (the Managers | Threads segment at its
// left, the shown view's options at its right) over a panel per tab, the chosen one shown; with none,
// the threads' list alone, its options on Activity's title. Each list stays mounted in one place in the
// tree, the other tab's hidden, so neither a tab switch nor a manager started or archived remounts one:
// its scroll and its focus stay. A first manager arriving never hides the threads, nor moves their
// options, from a reader at work in them.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { View } from "../../data/local-choice/choices.ts";
import { OUT3 } from "../../list/motion-plan.ts";
import type { Managers } from "../../model/activity.ts";
import { ManagerList } from "./manager-list.tsx";
import { PanelShown } from "../portal-scope.ts";
import { panelId, tabId, ViewSegment } from "./view-segment.tsx";

type Props = {
  /** The managers the Managers view lists, narrowed to its project if it has one. */
  managers: Managers;
  /** Each manager's row one line, its name alone. */
  managersCompact: boolean;
  /** Since when each thread has worked, for a manager's card; null where no card shows (a compact viewport). */
  underWaySince: ReadonlyMap<string, number> | null;
  view: View;
  onView(view: View): void;
  onNavigate(): void;
  /** Each view's options menu, at the control row's right end while that view shows. */
  options: Record<View, ReactNode>;
  /** The threads' list: a scroller (`.as-scroller`), the list's one tab stop. `titleOptions`: for Activity's title while there is no row to hold them, else null. */
  threads(titleOptions: ReactNode): ReactNode;
};

// why: the segment's thumb slides on the list's own ease-out, read from the one place it is defined.
const MOTION: CSSProperties & Record<"--as-ease-out", string> = { "--as-ease-out": OUT3 };

export function SidebarViews({ managers, managersCompact, underWaySince, view, onView, onNavigate, options, threads }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const hasManagers = managers.pinned.length + managers.unpinned.length > 0;
  const focus = useFocusInside();
  const { shown, settled, choose } = useShownView(hasManagers, view, onView, focus.inside);
  useFocusKeptWhenManagersGo(root, hasManagers, focus.inside);
  const keepOutOfHidden = useFocusOutOfHiddenPanels(id, shown, focus.inside);
  // why: a hidden panel is out of the tab order, so the sidebar keeps one keyboard stop, the shown scroller.
  const panel = (of: View) => (hasManagers ? { role: "tabpanel", id: panelId(id, of), "aria-labelledby": tabId(id, of), hidden: shown !== of } : {});

  return (
    <div
      ref={root}
      className="as-views"
      style={MOTION}
      onFocus={(e) => {
        focus.entered();
        keepOutOfHidden(e.target);
      }}
      onBlur={focus.left}
    >
      {hasManagers && (
        <div className="as-controls">
          <ViewSegment id={id} view={shown} onChange={choose} />
          {/* why keyed: each view's menu is its own, so one open closes as the other view is chosen. */}
          {settled && <span key={shown} className="as-controls-end">{options[shown]}</span>}
        </div>
      )}
      {/* why: each panel tells what it holds whether it shows, so a hidden one's overlays close (portal-scope.ts). */}
      {hasManagers && (
        <PanelShown.Provider value={shown === "managers"}>
          <div className="as-panel" {...panel("managers")}>
            <ManagerList managers={managers} compact={managersCompact} underWaySince={underWaySince} onNavigate={onNavigate} />
          </div>
        </PanelShown.Provider>
      )}
      <PanelShown.Provider value={shown === "threads"}>
        <div className="as-panel" {...panel("threads")}>
          {threads(settled ? null : options.threads)}
        </div>
      </PanelShown.Provider>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Whether focus is in the sidebar, a menu it opened included: React bubbles a portal's focus here,
 * though the DOM doesn't hold it.
 */
function useFocusInside() {
  const [inside, setInside] = useState(false);
  return {
    inside,
    entered: () => setInside(true),
    left: (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setInside(false);
    },
  };
}

/**
 * The view on screen: the chosen one, but the threads while there are no managers, and still the
 * threads when the first manager arrives while the reader works in them (focus there, or in a menu
 * they opened), so the list isn't swapped out from under them. The chosen view returns with the next
 * pick of a tab, or the next time the sidebar opens. `settled`: the control row holds the options;
 * until then (no managers, or the threads kept) they stay on Activity's title, a menu open there too.
 */
function useShownView(hasManagers: boolean, view: View, onView: (view: View) => void, focusInside: boolean) {
  const [had, setHad] = useState(hasManagers);
  const [keptThreads, setKeptThreads] = useState(false);
  // why: React's "adjust state when a prop changes": decided in the render the first manager arrives in, before anything is hidden.
  if (had !== hasManagers) {
    setHad(hasManagers);
    setKeptThreads(hasManagers && focusInside);
  }
  const settled = hasManagers && !keptThreads;
  const shown: View = settled ? view : "threads";
  const choose = (next: View) => {
    setKeptThreads(false);
    onView(next);
  };
  return { shown, settled, choose };
}

/**
 * A panel hidden (a tab chosen, or the last manager gone) never keeps focus: focus left in it, dropped
 * from an overlay of it that closed, or handed back to a trigger in it later (a closing menu's) goes to
 * the chosen tab. Returns the check for focus arriving.
 */
function useFocusOutOfHiddenPanels(id: string, shown: View, focusInside: boolean) {
  useLayoutEffect(() => {
    const active = document.activeElement;
    const lost = active === null || active === document.body || !active.isConnected || inHiddenPanel(active);
    if (focusInside && lost) focusTab(id, shown);
  }, [id, shown, focusInside]);

  return (target: EventTarget) => {
    if (target instanceof Element && inHiddenPanel(target)) focusTab(id, shown);
  };
}

const inHiddenPanel = (el: Element): boolean => el.closest(".as-panel[hidden]") !== null;
const focusTab = (id: string, view: View) => document.getElementById(tabId(id, view))?.focus({ preventScroll: true });

/**
 * The last manager archived takes the segment and the Managers panel. Focus held in them (or in a menu
 * a row opened) passes to the threads' list instead of dropping to the page.
 */
function useFocusKeptWhenManagersGo(root: RefObject<HTMLDivElement | null>, hasManagers: boolean, focusInside: boolean) {
  const had = useRef(hasManagers);

  useLayoutEffect(() => {
    const went = had.current && !hasManagers;
    had.current = hasManagers;
    const active = document.activeElement;
    const dropped = active === null || active === document.body || !active.isConnected;
    if (went && focusInside && dropped) root.current?.querySelector<HTMLElement>(".as-scroller")?.focus({ preventScroll: true });
  }, [hasManagers, focusInside, root]);
}
