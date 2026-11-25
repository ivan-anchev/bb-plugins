// What the sidebar shows: with regional managers, the Managers | Threads segment over a panel per tab,
// the chosen one shown; with none, the threads' list alone. Each list stays mounted in one place in the
// tree, the other tab's hidden, so neither a tab switch nor a manager started or archived remounts one:
// its scroll and its focus stay. A first manager arriving never hides the threads from a reader at work in them.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { View } from "../../data/local-choice/choices.ts";
import { OUT3 } from "../../list/motion-plan.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { ManagerList } from "./manager-list.tsx";
import { PanelShown } from "../portal-scope.ts";
import { panelId, tabId, ViewSegment } from "./view-segment.tsx";

type Props = {
  managers: readonly ManagerModel[];
  /** Since when each thread has worked, for a manager's card; null where no card shows (a compact viewport). */
  underWaySince: ReadonlyMap<string, number> | null;
  view: View;
  onView(view: View): void;
  onNavigate(): void;
  /** The threads' list: a scroller (`.as-scroller`), the list's one tab stop. */
  threads: ReactNode;
};

// why: the segment's thumb slides on the list's own ease-out, read from the one place it is defined.
const MOTION: CSSProperties & Record<"--as-ease-out", string> = { "--as-ease-out": OUT3 };

// why: the view menu (Compact, the project filter) rides on Activity's title, so the Managers view, which neither changes, has none.
export function SidebarViews({ managers, underWaySince, view, onView, onNavigate, threads }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const hasManagers = managers.length > 0;
  const focus = useFocusInside();
  const { shown, choose } = useShownView(hasManagers, view, onView, focus.inside);
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
      {hasManagers && <ViewSegment id={id} view={shown} onChange={choose} />}
      {/* why: each panel tells what it holds whether it shows, so a hidden one's overlays close (portal-scope.ts). */}
      {hasManagers && (
        <PanelShown.Provider value={shown === "managers"}>
          <div className="as-panel" {...panel("managers")}>
            <ManagerList managers={managers} underWaySince={underWaySince} onNavigate={onNavigate} />
          </div>
        </PanelShown.Provider>
      )}
      <PanelShown.Provider value={shown === "threads"}>
        <div className="as-panel" {...panel("threads")}>
          {threads}
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
 * pick of a tab, or the next time the sidebar opens.
 */
function useShownView(hasManagers: boolean, view: View, onView: (view: View) => void, focusInside: boolean) {
  const [had, setHad] = useState(hasManagers);
  const [keptThreads, setKeptThreads] = useState(false);
  // why: React's "adjust state when a prop changes": decided in the render the first manager arrives in, before anything is hidden.
  if (had !== hasManagers) {
    setHad(hasManagers);
    setKeptThreads(hasManagers && focusInside);
  }
  const shown: View = !hasManagers || keptThreads ? "threads" : view;
  const choose = (next: View) => {
    setKeptThreads(false);
    onView(next);
  };
  return { shown, choose };
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
