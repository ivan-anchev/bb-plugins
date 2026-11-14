// The slot component: reads the hooks, runs the two pure steps (model, items) and hands the items
// to the viewport.
import { experimental_useSidebarThreads, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import type { SleepRecord } from "../contract.ts";
import { useMinute } from "../data/use-minute.ts";
import { listItems } from "../list/items.ts";
import { buildActivity } from "../model/activity.ts";
import { ListViewport } from "./list-viewport.tsx";

// why: issue 04 reads the sleeps from the plugin server; until then nothing sleeps.
const NO_SLEEPS: ReadonlyMap<string, SleepRecord> = new Map();

export function ActivityList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const live = experimental_useSidebarThreads();
  const now = useMinute();

  const items = useMemo(() => {
    const sections = buildActivity({ threads: live.threads, projects: live.projects, sleeps: NO_SLEEPS, now, activeThreadId });
    return listItems(sections, live.status);
  }, [live.threads, live.projects, live.status, now, activeThreadId]);

  return <ListViewport items={items} onNavigate={onNavigate} />;
}
