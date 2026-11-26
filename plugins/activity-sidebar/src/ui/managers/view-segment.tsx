// The Managers | Threads segment at the left of the sidebar's control row: two icons on a track, the
// chosen one on a sliding thumb, each named on hover and keyboard focus. The ARIA tabs pattern, ←/→
// (and Home/End) moving between the two tabs and showing each as it goes. Their panels are the
// sidebar's (sidebar-views.tsx).
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { VIEW_NAMES, type View } from "../../data/local-choice/choices.ts";
import type { Avatar } from "../../model/manager-look.ts";
import { Tooltip } from "../tooltip.tsx";
import { ManagerAvatar } from "./avatar/manager-avatar.tsx";

/** The look a regional manager has before one is chosen for it: a white round blob, its face neutral. */
const DEFAULT_AVATAR: Avatar = { kind: "blob", shape: "circle", hue: "white", expression: "neutral" };

// why: an icon's size, so the blob sits in its tab as the list glyph does in the other.
const ICON = 16;

const TABS: readonly { view: View; icon: ReactNode }[] = [
  // why following off: a still picture, never animated nor watching the cursor.
  { view: "managers", icon: <ManagerAvatar avatar={DEFAULT_AVATAR} following="off" size={ICON} /> },
  { view: "threads", icon: <Icon name="LayoutList" aria-hidden /> },
];

/** The tab of `view` in the segment `id` names, and the panel it controls. */
export const tabId = (id: string, view: View): string => `${id}-${view}-tab`;
export const panelId = (id: string, view: View): string => `${id}-${view}-panel`;

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
        <Tooltip key={tab.view} label={VIEW_NAMES[tab.view]}>
          <button
            ref={(node) => {
              if (node) tabs.set(tab.view, node);
              else tabs.delete(tab.view);
            }}
            type="button"
            role="tab"
            aria-label={VIEW_NAMES[tab.view]}
            id={tabId(id, tab.view)}
            aria-selected={tab.view === view}
            aria-controls={panelId(id, tab.view)}
            tabIndex={tab.view === view ? 0 : -1}
            onClick={() => {
              onChange(tab.view);
              // why: Safari doesn't focus a clicked button, and focus left in the panel now hidden would be lost.
              tabs.get(tab.view)?.focus();
            }}
            onKeyDown={onKeyDown}
          >
            {tab.icon}
          </button>
        </Tooltip>
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
