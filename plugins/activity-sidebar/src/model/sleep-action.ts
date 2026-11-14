// What a row adds to bb's own thread menu: Sleep ▸ with Zeron's times and Custom…, or Wake while asleep.
// bb's menu holds everything else, so its confirmations, Undo toast and errors are bb's.
import { experimental_THREAD_ACTION_GROUPS as GROUPS, type PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk/app";
import type { RowModel } from "./activity.ts";
import { sleepPresets } from "./sleep.ts";

/** Sleep's moon and Wake's sun, registered by app.tsx: bb's icon set has neither. */
export const SLEEP_ICON = "activity-sidebar/moon";
export const WAKE_ICON = "activity-sidebar/sun";

/** What Sleep and Wake do: the list owns the sleeps, the row its Custom… dialog. */
export type SleepHandlers = { sleep(until: number): void; wake(): void; sleepCustom(): void };

const CUSTOM = "custom";

/**
 * Asleep, Wake; otherwise Sleep ▸ with Zeron's times, each "{name} · {when}" counted from `now`, then
 * Custom…. A pin holds its row in place and Archived has left the work, so neither offers Sleep.
 */
export function sleepItem(row: RowModel, own: SleepHandlers, now: number): PluginThreadActionsInlineItem | null {
  const t = row.thread;
  if (t.isPinned || t.isArchived) return null;
  if (row.asleepUntil !== null) return { key: "wake", group: GROUPS.state, action: { label: "Wake", icon: WAKE_ICON, run: own.wake } };
  const times = sleepPresets(new Date(now)).map((p) => ({ id: String(p.until), label: `${p.label} · ${p.when}` }));
  return {
    key: "sleep",
    group: GROUPS.state,
    action: {
      label: "Sleep",
      icon: SLEEP_ICON,
      choices: { items: [...times, { id: CUSTOM, label: "Custom…" }] },
      run: ({ value }) => (value === CUSTOM ? own.sleepCustom() : own.sleep(Number(value))),
    },
  };
}
