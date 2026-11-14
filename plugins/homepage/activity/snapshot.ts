// The saved activity snapshot: the card reads it instantly, and a background
// refresh replaces it. Concurrent refreshes share one run, and a failed
// GitHub read keeps the PRs from the last good one.
import type { Activity, MergedPr } from "../contract.ts";
import { addDays, gridStart, startOfDay } from "./days.ts";

const KEY = "activity";

export interface SnapshotDeps {
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  readMergedPrs(since: string): Promise<MergedPr[]>;
  readThreadStarts(since: number): Promise<number[]>;
  describeFailure(error: unknown): string;
  /** Called after every refresh, so open cards read the new snapshot. */
  onRefreshed(): void;
  warn(message: string): void;
  now(): number;
}

export function createSnapshot(deps: SnapshotDeps) {
  let running: Promise<Activity> | null = null;

  function refresh(): Promise<Activity> {
    running ??= rebuild(deps).finally(() => (running = null));
    return running;
  }

  /** The saved snapshot, or the first one built on demand. */
  async function read(): Promise<Activity> {
    return (await deps.kv.get<Activity>(KEY)) ?? refresh();
  }

  return { read, refresh };
}

async function rebuild(deps: SnapshotDeps): Promise<Activity> {
  // why: a week before the grid's first Monday, so a client in another time zone still has its whole window.
  const since = addDays(gridStart(startOfDay(deps.now())), -7);
  const saved = await deps.kv.get<Activity>(KEY);
  const [prs, threads] = await Promise.allSettled([deps.readMergedPrs(isoDate(since)), deps.readThreadStarts(since)]);

  if (prs.status === "rejected") deps.warn(`GitHub read failed: ${String(prs.reason)}`);
  if (threads.status === "rejected") deps.warn(`Thread read failed: ${String(threads.reason)}`);

  const keptPrs = prs.status === "fulfilled" ? prs.value : (saved?.prs ?? null);
  const next: Activity = {
    prs: keptPrs,
    threadStarts: threads.status === "fulfilled" ? threads.value : (saved?.threadStarts ?? []),
    problem: keptPrs === null && prs.status === "rejected" ? deps.describeFailure(prs.reason) : null,
  };
  await deps.kv.set(KEY, next);
  deps.onRefreshed();
  return next;
}

/** YYYY-MM-DD of a local day, for GitHub's `merged:>=` qualifier. */
export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
