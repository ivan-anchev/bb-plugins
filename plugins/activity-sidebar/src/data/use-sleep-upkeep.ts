import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { NOTHING_TRIED, upkeepWrites } from "../model/sleep-upkeep.ts";
import type { Sleeps } from "./use-sleeps.ts";

type Input = { threads: readonly PluginSidebarThread[]; sleeps: Sleeps; now: number; activeThreadId: string | null };

export function useSleepUpkeep({ threads, sleeps, now, activeThreadId }: Input): void {
  const tried = useRef(NOTHING_TRIED);
  const { wake, forget } = sleeps;

  useEffect(() => {
    const due = upkeepWrites({ threads, sleeps: sleeps.sleeps, now, activeThreadId }, tried.current);
    tried.current = due.tried;
    for (const threadId of due.wake) wake(threadId);
    for (const threadId of due.forget) forget(threadId);
  }, [threads, sleeps.sleeps, now, activeThreadId]);
}
