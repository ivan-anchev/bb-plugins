import type { MouseEvent } from "react";
import { tabs } from "../controller/tabs.ts";
import type { TabsSnapshot } from "../controller/tabs-controller.ts";
import { focused, type Layout } from "../model/layout.ts";
import type { Tab } from "../model/tab-set.ts";
import { stackOf } from "./card-stack.ts";
import { ProjectStack } from "./project-stack.tsx";

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
        <ProjectStack projects={stackOf(tab.layout, (id) => index.projects.get(id))} />
        <span className="ht-title">{label}</span>
      </button>
      {onClose !== null && (
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

function preventAutoscroll(event: MouseEvent): void {
  if (event.button === 1) event.preventDefault();
}

function labelOf(layout: Layout, index: Index): string {
  const content = focused(layout).content;
  switch (content.kind) {
    case "thread":
      return index.threads.get(content.threadId)?.displayTitle ?? "Thread";
    case "new-thread":
      return "New thread";
    case "plugin-panel":
    case "plugin-detail":
      return "Plugin";
    default:
      content satisfies never;
      return "Tab";
  }
}

