// What the sidebar shows: with no regional managers, the threads' list alone, as it was before
// managers; with them, the Managers | Threads segment over the chosen view.
import type { ReactNode } from "react";
import type { View } from "../../data/local-choice/choices.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { ManagerList } from "./manager-list.tsx";
import { ViewTabs } from "./view-tabs.tsx";

type Props = {
  managers: readonly ManagerModel[];
  view: View;
  onView(view: View): void;
  onNavigate(): void;
  /** The threads' list. */
  threads: ReactNode;
};

// why: the view menu (Compact, the project filter) rides on Activity's title, so the Managers view, which neither changes, has none.
export function SidebarViews({ managers, view, onView, onNavigate, threads }: Props) {
  if (managers.length === 0) return threads;
  return (
    <ViewTabs view={view} onChange={onView}>
      {view === "managers" ? <ManagerList managers={managers} onNavigate={onNavigate} /> : threads}
    </ViewTabs>
  );
}
