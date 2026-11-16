// The strip: a WAI-ARIA tablist of every tab, then `+`. The selected tab, else the live one, is its one tab
// stop.
import { useLayoutEffect, useRef } from "react";
import { tabs, useTabs } from "../controller/tabs.ts";
import { TabItem } from "./tab.tsx";

export function Strip() {
  const snapshot = useTabs();
  const tablist = useRef<HTMLDivElement>(null);
  /** The tab button that had focus when a tab was closed. */
  const closedFrom = useRef<Element | null>(null);

  // why: closing the tab that holds focus unmounts its button, and focus would drop to the page body
  // (REVIEW.md focus rule); it moves to the tab stop, the tab that took over.
  useLayoutEffect(() => {
    const held = closedFrom.current;
    closedFrom.current = null;
    if (held !== null && !held.isConnected) tablist.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus();
  });

  if (snapshot === null) return null;
  const { set, selectedId } = snapshot;
  const close = (id: string) => {
    closedFrom.current = tablist.current?.contains(document.activeElement) ? document.activeElement : null;
    tabs.close(id);
  };
  return (
    <div className="ht-strip">
      <div ref={tablist} role="tablist" aria-label="Tabs" className="ht-tablist">
        {set.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            selected={tab.id === selectedId}
            tabStop={tab.id === (selectedId ?? set.liveId)}
            onClose={set.tabs.length > 1 ? () => close(tab.id) : null}
            index={snapshot}
          />
        ))}
      </div>
      <button type="button" className="ht-new" aria-label="New tab" title="New tab" onClick={() => tabs.openNew()}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
