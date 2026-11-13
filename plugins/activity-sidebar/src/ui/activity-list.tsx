// The slot component: reads the hooks, runs the two pure steps (model, items) and hands the items
// to the viewport. Owns the reader's choices (folds, filter, how far Archived is unrolled), nothing derived.
import { experimental_useSidebarThreads, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";
import { parseFilter, parseOpen } from "../data/choices.ts";
import { useLocalChoice } from "../data/use-local-choice.ts";
import { useMinute } from "../data/use-minute.ts";
import { useSleepUpkeep } from "../data/use-sleep-upkeep.ts";
import { useSleeps } from "../data/use-sleeps.ts";
import { ARCHIVED_FIRST, ARCHIVED_STEP, listItems, type NoticeKey } from "../list/items.ts";
import { buildActivity, type SectionKey } from "../model/activity.ts";
import { ListViewport } from "./list-viewport.tsx";
import { ProjectFilter } from "./project-filter.tsx";

// why: one read for both lifecycles, so the Archived shelf's first page (and its "n+") loads at mount.
const LIFECYCLES = { experimental_lifecycles: ["active", "archived"] } as const;

export function ActivityList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const live = experimental_useSidebarThreads(LIFECYCLES);
  const archive = archivePager(live.experimental_archived);
  const sleeps = useSleeps();
  const now = useMinute();
  const [open, setOpen] = useLocalChoice("open-sections", parseOpen);
  const [filter, setFilter] = useLocalChoice("project-filter", parseFilter);
  const [archivedShown, setArchivedShown] = useState(ARCHIVED_FIRST);
  useSleepUpkeep({ threads: live.threads, sleeps, now, activeThreadId });

  // why: a project removed since the choice was made narrows nothing (Zeron: sidebar.luau only_project).
  const chosen = live.projects.find((p) => p.id === filter) ?? null;
  const sections = useMemo(
    () => buildActivity({ threads: live.threads, projects: live.projects, sleeps: sleeps.sleeps, now, activeThreadId, filter: chosen?.id ?? null }),
    [live.threads, live.projects, sleeps.sleeps, now, activeThreadId, chosen],
  );
  const items = useMemo(
    () => listItems(sections, { status: live.status, sleeps: sleeps.status, open: new Set(open), archivedShown, archive, filterName: chosen?.name ?? null }),
    [sections, live.status, sleeps.status, open, archivedShown, archive, chosen],
  );

  const toggle = (key: SectionKey) => setOpen(open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);

  // why: the press reveals rows already loaded first; past them, the next page is asked for.
  const showMoreArchived = () => {
    const next = archivedShown + ARCHIVED_STEP;
    const loaded = sections.find((s) => s.key === "archived")?.rows.length ?? 0;
    if (next > loaded && archive.hasNextPage) void archive.fetchNextPage();
    setArchivedShown(next);
  };

  const retry = (notice: NoticeKey) => (notice === "n:sleeps" ? sleeps.refetch() : void archive.fetchNextPage());

  return (
    <ListViewport
      items={items}
      onNavigate={onNavigate}
      sleep={{ sleep: sleeps.sleep, wake: sleeps.wake }}
      onToggle={toggle}
      onShowMoreArchived={showMoreArchived}
      onRetry={retry}
      filterMenu={<ProjectFilter projects={live.projects} chosen={chosen} onChoose={setFilter} />}
    />
  );
}

// ------------------------------------------------------------------ layer 2

/** The archived pager; bb returns it whenever the archived lifecycle is requested, as here. */
function archivePager<T>(pager: T | null): T {
  if (pager === null) throw new Error("activity-sidebar: bb returned no archived pager although archived threads were requested");
  return pager;
}
