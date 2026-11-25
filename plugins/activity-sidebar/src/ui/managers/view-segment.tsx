// The Managers | Threads segment at the top of the sidebar: the ARIA tabs pattern, ←/→ (and Home/End)
// moving between the two tabs and showing each as it goes. Its panel is the sidebar's (sidebar-views.tsx).
import { useRef, type KeyboardEvent } from "react";
import type { View } from "../../data/local-choice/choices.ts";

const TABS: readonly { view: View; label: string }[] = [
  { view: "managers", label: "Managers" },
  { view: "threads", label: "Threads" },
];

/** The tab of `view` in the segment `id` names, and the panel they control. */
export const tabId = (id: string, view: View): string => `${id}-${view}`;
export const panelId = (id: string): string => `${id}-panel`;

export function ViewSegment({ id, view, onChange }: { id: string; view: View; onChange(view: View): void }) {
  const tabs = useRef(new Map<View, HTMLButtonElement>()).current;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabAfter(e.key, view);
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    tabs.get(next)?.focus();
  };

  return (
    <div className="as-segment" role="tablist" aria-label="Show" data-on={view}>
      <span className="as-segment-thumb" aria-hidden />
      {TABS.map((tab) => (
        <button
          key={tab.view}
          ref={(node) => {
            if (node) tabs.set(tab.view, node);
            else tabs.delete(tab.view);
          }}
          type="button"
          role="tab"
          id={tabId(id, tab.view)}
          aria-selected={tab.view === view}
          aria-controls={panelId(id)}
          tabIndex={tab.view === view ? 0 : -1}
          onClick={() => onChange(tab.view)}
          onKeyDown={onKeyDown}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/** The tab a key moves to from `view`: ←/→ to the other one (two tabs, so either way), Home the first, End the last. */
function tabAfter(key: string, view: View): View | null {
  const at = TABS.findIndex((tab) => tab.view === view);
  switch (key) {
    case "ArrowLeft":
      return TABS[(at - 1 + TABS.length) % TABS.length].view;
    case "ArrowRight":
      return TABS[(at + 1) % TABS.length].view;
    case "Home":
      return TABS[0].view;
    case "End":
      return TABS[TABS.length - 1].view;
    default:
      return null;
  }
}
