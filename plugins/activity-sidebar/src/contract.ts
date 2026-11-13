/**
 * A thread put to sleep until `until` (epoch ms). `until > now`: asleep; `until <= now`: woke at
 * `until`; no record: awake. Issue 04 stores these on the plugin server and gives them their RPC
 * schema here; until then the list has none.
 */
export type SleepRecord = { threadId: string; until: number };
