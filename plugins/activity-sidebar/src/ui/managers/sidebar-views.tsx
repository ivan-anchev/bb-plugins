// What the sidebar shows: with regional managers, the Managers | Threads segment over a panel per tab,
// the chosen one shown; with none, the threads' list alone. Each list stays mounted in one place in the
// tree, the other tab's hidden, so neither a tab switch nor a manager started or archived remounts one:
// its scroll and its focus stay.
import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { View } from "../../data/local-choice/choices.ts";
import { OUT3 } from "../../list/motion-plan.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { ManagerList } from "./manager-list.tsx";
import { panelId, tabId, ViewSegment } from "./view-segment.tsx";

type Props = {
  managers: readonly ManagerModel[];
  view: View;
  onView(view: View): void;
  onNavigate(): void;
  /** The threads' list: a scroller (`.as-scroller`), the list's one tab stop. */
  threads: ReactNode;
};

// why: the segment's thumb slides on the list's own ease-out, read from the one place it is defined.
const MOTION: CSSProperties & Record<"--as-ease-out", string> = { "--as-ease-out": OUT3 };

// why: the view menu (Compact, the project filter) rides on Activity's title, so the Managers view, which neither changes, has none.
export function SidebarViews({ managers, view, onView, onNavigate, threads }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const hasManagers = managers.length > 0;
  const shown: View = hasManagers ? view : "threads";
  const focus = useFocusKeptAcrossSegment(root, hasManagers);
  // why: a hidden panel is out of the tab order, so the sidebar keeps one keyboard stop, the shown scroller.
  const panel = (of: View) => (hasManagers ? { role: "tabpanel", id: panelId(id, of), "aria-labelledby": tabId(id, of), hidden: shown !== of } : {});

  return (
    <div ref={root} className="as-views" style={MOTION} onFocus={focus.entered} onBlur={focus.left}>
      {hasManagers && <ViewSegment id={id} view={view} onChange={onView} />}
      {hasManagers && (
        <div className="as-panel" {...panel("managers")}>
          <ManagerList managers={managers} onNavigate={onNavigate} />
        </div>
      )}
      <div className="as-panel" {...panel("threads")}>
        {threads}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * The first manager started or the last archived brings or takes the segment and, with Managers
 * chosen, swaps the shown list. Focus held in what went or hid (or in a menu it opened; React bubbles
 * its focus here) passes to the list now shown instead of dropping to the page or staying unseen.
 */
function useFocusKeptAcrossSegment(root: RefObject<HTMLDivElement | null>, hasManagers: boolean) {
  const inside = useRef(false);
  const had = useRef(hasManagers);

  useLayoutEffect(() => {
    const crossed = had.current !== hasManagers;
    had.current = hasManagers;
    const active = document.activeElement;
    const lost = active === null || active === document.body || !active.isConnected || active.closest(".as-panel[hidden]") !== null;
    if (crossed && inside.current && lost) root.current?.querySelector<HTMLElement>(".as-panel:not([hidden]) .as-scroller")?.focus({ preventScroll: true });
  }, [hasManagers, root]);

  return {
    entered: () => {
      inside.current = true;
    },
    left: (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) inside.current = false;
    },
  };
}
