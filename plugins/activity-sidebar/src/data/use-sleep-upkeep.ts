// Sends the list's own sleep writes (src/model/sleep-upkeep.ts) through the sleeps' wake and forget,
// which say so when refused. Each record is tried once per write, so a refusal is said once and its
// rollback doesn't send it again.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { NOTHING_TRIED, upkeepWrites } from "../model/sleep-upkeep.ts";
import type { Sleeps } from "./use-sleeps.ts";

type Input = { threads: readonly PluginSidebarThread[]; sleeps: Sleeps; now: number; activeThreadId: string | null };

export function useSleepUpkeep({ threads, sleeps, now, activeThreadId }: Input): void {
  const tried = useRef(NOTHING_TRIED);
  const { wake, forget } = sleeps;

  // Deps are the data the writes are decided from; new `wake` and `forget` functions decide nothing.
  useEffect(() => {
    const due = upkeepWrites({ threads, sleeps: sleeps.sleeps, now, activeThreadId }, tried.current);
    tried.current = due.tried;
    for (const threadId of due.wake) wake(threadId);
    for (const threadId of due.forget) forget(threadId);
  }, [threads, sleeps.sleeps, now, activeThreadId]);
}
