// The one Zeron state a thread shows (Zeron: ds/status.luau), from bb's resolved indicator.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SleepRecord } from "../contract.ts";

export type ZState = "working" | "connecting" | "waiting" | "input" | "approval" | "done" | "failed" | "woke";

/** Under way: running, or waiting on work that will wake it (Zeron: screens/shell/activity.luau). */
export const UNDER_WAY: ReadonlySet<ZState> = new Set(["working", "connecting", "waiting"]);

/** Zeron's long names, for tooltips and accessible names. */
export const STATE_NAME: Record<ZState, string> = {
  working: "Working",
  connecting: "Connecting",
  waiting: "Waiting",
  input: "Awaiting Input",
  approval: "Pending Approval",
  done: "Completed",
  failed: "Failed",
  woke: "Woke from sleep",
};

/**
 * A thread's state before Sleep is considered. bb already applied its precedence (attention before
 * work), so this maps each indicator to one state and never re-ranks them.
 */
export function baseState(thread: PluginSidebarThread): ZState | null {
  const indicator = thread.indicator;
  switch (indicator) {
    case "waiting-for-input":
      // why: bb's row can't tell an approval from a question; issue 05 refines it per row.
      return "input";
    case "unread-error":
    case "queued-failed":
      return "failed";
    case "unread-success":
      return "done";
    case "runtime":
      return thread.runtimeStatus === "provisioning" || thread.runtimeStatus === "waiting-for-host" ? "connecting" : "working";
    case "plan-mode":
    case "goal":
    case "workflow":
    case "queued-waiting":
    case "working-draft":
      return "working";
    case "background-agent":
    case "background-command":
      // why: Zeron's "waiting": the turn is over, but background work will wake the thread.
      return "waiting";
    case "draft":
    case "none":
      return null;
    default:
      // why: a newer bb's indicator lands here at runtime and draws nothing (REVIEW.md).
      indicator satisfies never;
      return null;
  }
}

/** The state a row shows: a woken sleeper's alarm, unless it has something more to say. */
export function stateOf(thread: PluginSidebarThread, sleep: SleepRecord | undefined, now: number): ZState | null {
  const base = baseState(thread);
  if (sleep !== undefined && sleep.until <= now && (base === null || base === "done")) return "woke";
  return base;
}
