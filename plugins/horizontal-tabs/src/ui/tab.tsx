// One tab: the project tiles of its threads, then its focused pane's title. Click shows its layout; × (on
// hover) and middle-click close it.
import type { MouseEvent } from "react";
import { tabs } from "../controller/tabs.ts";
import type { TabsSnapshot } from "../controller/tabs-controller.ts";
import { focused, panes, type Layout } from "../model/layout.ts";
import type { Tab } from "../model/tab-set.ts";
import { hueOf } from "./project-hue.ts";
import { ProjectTile } from "./project-tile.tsx";

type Index = Pick<TabsSnapshot, "threads" | "projects">;

type Props = {
  tab: Tab;
  selected: boolean;
  tabStop: boolean;
  /** Null for the last tab, which can't close. */
  onClose: (() => void) | null;
  index: Index;
};

export function TabItem({ tab, selected, tabStop, onClose, index }: Props) {
  const label = labelOf(tab.layout, index);
  const closeOnMiddleClick = (event: MouseEvent) => {
    if (event.button === 1 && onClose !== null) onClose();
  };
  return (
    <div className="ht-tab" onMouseDown={preventAutoscroll} onAuxClick={closeOnMiddleClick}>
      <button
        type="button"
        role="tab"
        className="ht-tab-button"
        aria-selected={selected}
        tabIndex={tabStop ? 0 : -1}
        title={label}
        onClick={() => tabs.activate(tab.id)}
      >
        <span className="ht-tiles">
          {projectsOf(tab.layout, index).map((project) => (
            <ProjectTile key={project.id} name={project.name} hue={hueOf(project.id)} />
          ))}
        </span>
        <span className="ht-title">{label}</span>
      </button>
      {onClose !== null && (
        // why: a mouse affordance, out of the tab order. Its mousedown is prevented so it never takes focus,
        // which would drop to the page body when the tab unmounts (REVIEW.md focus rule).
        <button
          type="button"
          className="ht-close"
          tabIndex={-1}
          aria-label={`Close ${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** A middle-button press would start the browser's autoscroll; the click that follows closes the tab. */
function preventAutoscroll(event: MouseEvent): void {
  if (event.button === 1) event.preventDefault();
}

function labelOf(layout: Layout, index: Index): string {
  const content = focused(layout).content;
  switch (content.kind) {
    case "thread":
      // Until the sidebar's thread index loads.
      return index.threads.get(content.threadId)?.displayTitle ?? "Thread";
    case "new-thread":
      return "New thread";
    case "plugin-panel":
    case "plugin-detail":
      return "Plugin";
    default:
      content satisfies never;
      // why: a newer bb may store a pane kind this plugin doesn't know; name the tab neutrally.
      return "Tab";
  }
}

/** The distinct projects of the layout's threads, in pane order; unknown until the index loads. */
function projectsOf(layout: Layout, index: Index) {
  const ids = new Set(panes(layout).flatMap((pane) => (pane.content.kind === "thread" ? [pane.content.projectId] : [])));
  return [...ids].flatMap((id) => index.projects.get(id) ?? []);
}
