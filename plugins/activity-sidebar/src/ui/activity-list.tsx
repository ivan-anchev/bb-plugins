// The slot component: reads the hooks, runs the two pure steps (model, items) and hands the items
// to the viewport, under the Managers | Threads control row while there are regional managers. Owns the
// reader's choices (view, folds, each view's filter and density, how far Archived is unrolled), nothing derived.
import { experimental_useSidebarThreads, type PluginSidebarProject, type PluginSidebarThread, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";
import { underWaySince } from "../card/under-way.ts";
import { parseCompact, parseFilter, parseManagersCompact, parseOpen, parseView } from "../data/local-choice/choices.ts";
import { useLocalChoice } from "../data/local-choice/use-local-choice.ts";
import { useArchivedCount } from "../data/use-archived-count.ts";
import { useManagerLines } from "../data/managers/use-manager-lines.ts";
import { useManagerLooks } from "../data/managers/use-manager-looks.ts";
import { useMinute } from "../data/use-minute.ts";
import { useSleepUpkeep } from "../data/use-sleep-upkeep.ts";
import { useSleeps } from "../data/use-sleeps.ts";
import { useHandoffs } from "../handoff/use-handoffs.ts";
import { ARCHIVED_FIRST, ARCHIVED_STEP, listItems, retryNotice, type NoticeKey } from "../list/items.ts";
import { buildActivity, isOpenManager, type Managers, type SectionKey } from "../model/activity.ts";
import { managerProjects, narrowManagers } from "../model/manager-filter.ts";
import type { ThreadIndex } from "../model/thread-index.ts";
import { ListViewport } from "./list-viewport.tsx";
import { SidebarViews } from "./managers/sidebar-views.tsx";
import { ViewMenu } from "./view-menu.tsx";

// why: one read for both lifecycles, so the Archived shelf's first page has loaded by the time it opens.
const LIFECYCLES = { experimental_lifecycles: ["active", "archived"] } as const;

export function ActivityList({ activeThreadId, isCompactViewport, onNavigate }: PluginThreadListProps) {
  const live = experimental_useSidebarThreads(LIFECYCLES);
  const archive = archivePager(live.experimental_archived);
  const sleeps = useSleeps();
  const held = useHandoffs(live.threads);
  const now = useMinute();
  const [open, setOpen] = useLocalChoice("open-sections", parseOpen);
  const [filter, setFilter] = useLocalChoice("project-filter", parseFilter);
  const [compact, setCompact] = useLocalChoice("compact", parseCompact);
  const [view, setView] = useLocalChoice("view", parseView);
  const [archivedShown, setArchivedShown] = useState(ARCHIVED_FIRST);
  useSleepUpkeep({ threads: live.threads, sleeps, now, activeThreadId });

  // why: a project removed since the choice was made narrows nothing.
  const chosen = live.projects.find((p) => p.id === filter) ?? null;
  const archivedCount = useArchivedCount(chosen?.id ?? null);
  // why sorted: the managers' lines are read by these ids, so the same managers ask the same read.
  const managerIds = useMemo(() => live.threads.filter(isOpenManager).map((t) => t.id).sort(), [live.threads]);
  const looks = useManagerLooks(managerIds.length > 0);
  const lines = useManagerLines(managerIds);
  const model = useMemo(
    () => buildActivity({ threads: live.threads, projects: live.projects, sleeps: sleeps.sleeps, held, now, activeThreadId, filter: chosen?.id ?? null, looks, lines }),
    [live.threads, live.projects, sleeps.sleeps, held, now, activeThreadId, chosen, looks, lines],
  );
  const items = useMemo(
    () =>
      listItems(model.sections, { status: live.status, sleeps: sleeps.status, open: new Set(open), archivedShown, archive, archivedCount: archivedCount.count, filterName: chosen?.name ?? null, compact }),
    [model, live.status, sleeps.status, open, archivedShown, archive, archivedCount.count, chosen, compact],
  );

  const managers = useManagersView(model.managers, live.projects);
  const since = useUnderWaySince(live.threads, model.index);
  // why: no hover at compact width (Zeron shows no card on the rail or in a flyout).
  const card = useMemo(() => (isCompactViewport ? null : { index: model.index, underWaySince: since }), [isCompactViewport, model.index, since]);

  const toggle = (key: SectionKey) => setOpen(open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);

  // why: the press reveals rows already loaded first; past them, the next page is asked for.
  const showMoreArchived = () => {
    const next = archivedShown + ARCHIVED_STEP;
    const loaded = model.sections.find((s) => s.key === "archived")?.rows.length ?? 0;
    if (next > loaded && archive.hasNextPage) void archive.fetchNextPage();
    setArchivedShown(next);
  };

  const retry = (notice: NoticeKey) =>
    retryNotice(notice, { sleeps: sleeps.refetch, archivedCount: archivedCount.refetch, archivedPage: () => void archive.fetchNextPage() });

  return (
    <SidebarViews
      managers={managers.shown}
      managersCompact={managers.compact}
      underWaySince={card === null ? null : card.underWaySince}
      view={view}
      onView={setView}
      onNavigate={onNavigate}
      options={{
        threads: <ViewMenu view="threads" projects={live.projects} chosen={chosen} onChoose={setFilter} compact={compact} onCompact={setCompact} />,
        managers: <ViewMenu view="managers" projects={managers.projects} chosen={managers.chosen} onChoose={managers.choose} compact={managers.compact} onCompact={managers.setCompact} />,
      }}
      threads={(titleOptions) => (
        <ListViewport
          items={items}
          card={card}
          onNavigate={onNavigate}
          sleep={{ sleep: sleeps.sleep, wake: sleeps.wake }}
          onToggle={toggle}
          onShowMoreArchived={showMoreArchived}
          onRetry={retry}
          viewMenu={titleOptions}
        />
      )}
    />
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * The Managers view's own choices, apart from the threads': its density, and the project it is narrowed
 * to, offered only while the managers span two or more. A project no longer offered narrows nothing.
 */
function useManagersView(all: Managers, projects: readonly PluginSidebarProject[]) {
  const [filter, choose] = useLocalChoice("managers-project-filter", parseFilter);
  const [compact, setCompact] = useLocalChoice("managers-compact", parseManagersCompact);
  const offered = useMemo(() => managerProjects(all, projects), [all, projects]);
  const chosen = offered.find((p) => p.id === filter) ?? null;
  const shown = useMemo(() => narrowManagers(all, chosen?.id ?? null), [all, chosen]);
  return { shown, projects: offered, chosen, choose, compact, setCompact };
}

/** Since when each thread has been under way, carried over from one live update (or hold released) to the next. */
function useUnderWaySince(threads: readonly PluginSidebarThread[], index: ThreadIndex): ReadonlyMap<string, number> {
  const [seen, setSeen] = useState(() => ({ index, since: underWaySince(new Map(), threads, index) }));
  // why: React's "adjust state when a prop changes": each new index builds on the last sightings.
  if (seen.index === index) return seen.since;
  const next = { index, since: underWaySince(seen.since, threads, index) };
  setSeen(next);
  return next.since;
}

/** The archived pager; bb returns it whenever the archived lifecycle is requested, as here. */
function archivePager<T>(pager: T | null): T {
  if (pager === null) throw new Error("activity-sidebar: bb returned no archived pager although archived threads were requested");
  return pager;
}
