// The slot component: reads the hooks, runs the two pure steps (model, items) and hands the items
// to the viewport. Owns the reader's choices (folds, filter, density, how far Archived is unrolled), nothing derived.
import { experimental_useSidebarThreads, type PluginSidebarThread, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";
import { underWaySince } from "../card/under-way.ts";
import { parseCompact, parseFilter, parseOpen } from "../data/local-choice/choices.ts";
import { useLocalChoice } from "../data/local-choice/use-local-choice.ts";
import { useArchivedCount } from "../data/use-archived-count.ts";
import { useMinute } from "../data/use-minute.ts";
import { useSleepUpkeep } from "../data/use-sleep-upkeep.ts";
import { useSleeps } from "../data/use-sleeps.ts";
import { ARCHIVED_FIRST, ARCHIVED_STEP, listItems, retryNotice, type NoticeKey } from "../list/items.ts";
import { buildActivity, type SectionKey } from "../model/activity.ts";
import { ListViewport } from "./list-viewport.tsx";
import { ViewMenu } from "./view-menu.tsx";

// why: one read for both lifecycles, so the Archived shelf's first page has loaded by the time it opens.
const LIFECYCLES = { experimental_lifecycles: ["active", "archived"] } as const;

export function ActivityList({ activeThreadId, isCompactViewport, onNavigate }: PluginThreadListProps) {
  const live = experimental_useSidebarThreads(LIFECYCLES);
  const archive = archivePager(live.experimental_archived);
  const sleeps = useSleeps();
  const now = useMinute();
  const [open, setOpen] = useLocalChoice("open-sections", parseOpen);
  const [filter, setFilter] = useLocalChoice("project-filter", parseFilter);
  const [compact, setCompact] = useLocalChoice("compact", parseCompact);
  const [archivedShown, setArchivedShown] = useState(ARCHIVED_FIRST);
  useSleepUpkeep({ threads: live.threads, sleeps, now, activeThreadId });

  // why: a project removed since the choice was made narrows nothing.
  const chosen = live.projects.find((p) => p.id === filter) ?? null;
  const archivedCount = useArchivedCount(chosen?.id ?? null);
  const model = useMemo(
    () => buildActivity({ threads: live.threads, projects: live.projects, sleeps: sleeps.sleeps, now, activeThreadId, filter: chosen?.id ?? null }),
    [live.threads, live.projects, sleeps.sleeps, now, activeThreadId, chosen],
  );
  const items = useMemo(
    () =>
      listItems(model.sections, { status: live.status, sleeps: sleeps.status, open: new Set(open), archivedShown, archive, archivedCount: archivedCount.count, filterName: chosen?.name ?? null, compact }),
    [model, live.status, sleeps.status, open, archivedShown, archive, archivedCount.count, chosen, compact],
  );

  const since = useUnderWaySince(live.threads);
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
    <ListViewport
      items={items}
      card={card}
      onNavigate={onNavigate}
      sleep={{ sleep: sleeps.sleep, wake: sleeps.wake }}
      onToggle={toggle}
      onShowMoreArchived={showMoreArchived}
      onRetry={retry}
      viewMenu={<ViewMenu projects={live.projects} chosen={chosen} onChoose={setFilter} compact={compact} onCompact={setCompact} />}
    />
  );
}

// ------------------------------------------------------------------ layer 2

/** Since when each thread has been under way, carried over from one live update to the next. */
function useUnderWaySince(threads: readonly PluginSidebarThread[]): ReadonlyMap<string, number> {
  const [seen, setSeen] = useState(() => ({ threads, since: underWaySince(new Map(), threads) }));
  // why: React's "adjust state when a prop changes": each live update builds on the last sightings.
  if (seen.threads === threads) return seen.since;
  const next = { threads, since: underWaySince(seen.since, threads) };
  setSeen(next);
  return next.since;
}

/** The archived pager; bb returns it whenever the archived lifecycle is requested, as here. */
function archivePager<T>(pager: T | null): T {
  if (pager === null) throw new Error("activity-sidebar: bb returned no archived pager although archived threads were requested");
  return pager;
}
