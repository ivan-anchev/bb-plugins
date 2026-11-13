// A thread's plan while its card is open: bb's `pendingTodos`, read as the card opens and again whenever
// the thread's events can carry a changed step. Its `updatedAt` holds still through a turn (checked live:
// steps completed, `updatedAt` unmoved), so it can't say when to read again.
// The plan is read from the thread's timeline summary, the one request `status.get` makes for it:
// `status.get` turns each of its reads that fails into null, so there a failure would look like no plan.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { Todos } from "../card/plan-fold.ts";

/**
 * Events a plan changes in: Claude Code's task and todo tools complete as items, other providers report
 * the turn's plan (checked live: a TaskUpdate arrives as "item/completed"). Command output streams as
 * deltas, so a long command reads nothing until it ends.
 */
const PLAN_EVENTS: ReadonlySet<string> = new Set(["item/completed", "turn/plan/updated"]);

/**
 * What the card knows of a plan. `todos` is the last plan read, null with no thread, until a read lands,
 * or when bb has none. `failed`: the latest read failed, so `todos` may be out of date (or, null, unknown).
 * `retry` reads again.
 */
export type PlanRead = { todos: Todos | null; failed: boolean; retry(): void };

type Got = { threadId: string; todos: Todos | null; failed: boolean };

export function usePlan(threadId: string | null): PlanRead {
  const sdk = useSdk();
  const [got, setGot] = useState<Got | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (threadId === null) return;
    const abort = new AbortController();
    let latest = 0;
    const read = () => {
      const n = ++latest;
      // why: reads overlap when events come fast; only the last one asked for speaks, and a cancelled one never.
      const speaks = () => n === latest && !abort.signal.aborted;
      sdk.threads.timeline({ threadId, summaryOnly: "true", signal: abort.signal }).then(
        (timeline) => {
          if (speaks()) setGot({ threadId, todos: timeline.pendingTodos, failed: false });
        },
        () => {
          if (speaks()) setGot((was) => ({ threadId, todos: was !== null && was.threadId === threadId ? was.todos : null, failed: true }));
        },
      );
    };
    read();
    const stop = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: (event) => {
        if (event.metadata?.eventTypes?.some((type) => PLAN_EVENTS.has(type))) read();
      },
    });
    return () => {
      stop();
      abort.abort();
    };
    // why: `sdk` is the host's one instance; the thread says what to read and hear, `tries` reads it again.
  }, [threadId, tries]);

  const mine = got !== null && got.threadId === threadId ? got : null;
  return { todos: mine?.todos ?? null, failed: mine?.failed === true, retry: () => setTries((n) => n + 1) };
}
