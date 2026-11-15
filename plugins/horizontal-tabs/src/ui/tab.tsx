// One tab: the project tiles of its threads, then its focused pane's title.
import type { TabsSnapshot } from "../controller/tabs-controller.ts";
import { focused, panes, type Layout } from "../model/layout.ts";
import type { Tab } from "../model/tab-set.ts";
import { hueOf } from "./project-hue.ts";
import { ProjectTile } from "./project-tile.tsx";

type Index = Pick<TabsSnapshot, "threads" | "projects">;

export function TabItem({ tab, selected, tabStop, index }: { tab: Tab; selected: boolean; tabStop: boolean; index: Index }) {
  const label = labelOf(tab.layout, index);
  return (
    <button type="button" role="tab" className="ht-tab" aria-selected={selected} tabIndex={tabStop ? 0 : -1} title={label}>
      <span className="ht-tiles">
        {projectsOf(tab.layout, index).map((project) => (
          <ProjectTile key={project.id} name={project.name} hue={hueOf(project.id)} />
        ))}
      </span>
      <span className="ht-title">{label}</span>
    </button>
  );
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
