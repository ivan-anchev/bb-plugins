// What the sidebar shows: with regional managers, the Managers | Threads segment over the chosen view;
// with none, the threads' list alone. The threads' list keeps one place in the tree either way, so a
// manager started or archived never remounts it: its scroll and its focus stay.
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
  const focus = useFocusKeptOnLastManager(root, hasManagers);
  const panel = hasManagers ? { role: "tabpanel", id: panelId(id), "aria-labelledby": tabId(id, view) } : {};

  return (
    <div ref={root} className="as-views" style={MOTION} onFocus={focus.entered} onBlur={focus.left}>
      {hasManagers && <ViewSegment id={id} view={view} onChange={onView} />}
      <div className="as-panel" {...panel}>
        {hasManagers && view === "managers" ? <ManagerList managers={managers} onNavigate={onNavigate} /> : threads}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * The last manager gone takes the segment and the Managers view with it: focus held there (or in a
 * menu one of them opened; React bubbles its focus here) passes to the threads' list instead of
 * dropping to the page.
 */
function useFocusKeptOnLastManager(root: RefObject<HTMLDivElement | null>, hasManagers: boolean) {
  const inside = useRef(false);
  const had = useRef(hasManagers);

  useLayoutEffect(() => {
    const lost = had.current && !hasManagers;
    had.current = hasManagers;
    const active = document.activeElement;
    const dropped = active === null || active === document.body || !active.isConnected;
    if (lost && inside.current && dropped) root.current?.querySelector<HTMLElement>(".as-scroller")?.focus({ preventScroll: true });
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
