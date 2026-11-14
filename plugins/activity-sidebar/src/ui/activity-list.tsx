// The slot component: reads the hooks, runs the two pure steps (model, items) and hands the items
// to the viewport. Owns the reader's choices (folds, filter, how far Archived is unrolled), nothing derived.
import { experimental_useSidebarThreads, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";
import type { SleepRecord } from "../contract.ts";
import { parseFilter, parseOpen } from "../data/choices.ts";
import { useLocalChoice } from "../data/use-local-choice.ts";
import { useMinute } from "../data/use-minute.ts";
import { ARCHIVED_FIRST, ARCHIVED_STEP, listItems } from "../list/items.ts";
import { buildActivity, type SectionKey } from "../model/activity.ts";
import { ListViewport } from "./list-viewport.tsx";
import { ProjectFilter } from "./project-filter.tsx";

// why: issue 04 reads the sleeps from the plugin server; until then nothing sleeps.
const NO_SLEEPS: ReadonlyMap<string, SleepRecord> = new Map();
// why: one read for both lifecycles, so the Archived shelf's first page (and its "n+") loads at mount.
const LIFECYCLES = { experimental_lifecycles: ["active", "archived"] } as const;

export function ActivityList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const live = experimental_useSidebarThreads(LIFECYCLES);
  const archive = archivePager(live.experimental_archived);
  const now = useMinute();
  const [open, setOpen] = useLocalChoice("open-sections", parseOpen);
  const [filter, setFilter] = useLocalChoice("project-filter", parseFilter);
  const [archivedShown, setArchivedShown] = useState(ARCHIVED_FIRST);

  // why: a project removed since the choice was made narrows nothing (Zeron: sidebar.luau only_project).
  const chosen = live.projects.find((p) => p.id === filter) ?? null;
  const sections = useMemo(
    () => buildActivity({ threads: live.threads, projects: live.projects, sleeps: NO_SLEEPS, now, activeThreadId, filter: chosen?.id ?? null }),
    [live.threads, live.projects, now, activeThreadId, chosen],
  );
  const items = useMemo(
    () => listItems(sections, { status: live.status, open: new Set(open), archivedShown, archive, filterName: chosen?.name ?? null }),
    [sections, live.status, open, archivedShown, archive, chosen],
  );

  const toggle = (key: SectionKey) => setOpen(open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);

  // why: the press reveals rows already loaded first; past them, the next page is asked for.
  const showMoreArchived = () => {
    const next = archivedShown + ARCHIVED_STEP;
    const loaded = sections.find((s) => s.key === "archived")?.rows.length ?? 0;
    if (next > loaded && archive.hasNextPage) void archive.fetchNextPage();
    setArchivedShown(next);
  };

  return (
    <ListViewport
      items={items}
      onNavigate={onNavigate}
      onToggle={toggle}
      onShowMoreArchived={showMoreArchived}
      onRetryArchived={() => void archive.fetchNextPage()}
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
