// The list's own sleep writes, decided here and sent by src/data/use-sleep-upkeep.ts: a sleeper asking
// for you wakes for good, and opening a woken thread forgets its sleep, so its Woke glyph goes. Pure.
import type { SleepRecord } from "../contract.ts";
import { sleepersAskingForYou, type ActivityInput } from "./activity.ts";

/**
 * The records each write has been tried for, by `threadId@until`. why: a write is tried once per
 * record, so a refused one isn't sent again on every render its rollback causes. One set per write: a
 * refused early wake leaves the record as it was, and its later forget is a write of its own.
 */
export type Tried = { woken: ReadonlySet<string>; forgotten: ReadonlySet<string> };

export const NOTHING_TRIED: Tried = { woken: new Set(), forgotten: new Set() };

type UpkeepInput = Pick<ActivityInput, "threads" | "sleeps" | "now" | "activeThreadId">;

/** The threads to wake and to forget now, none tried before, and what has been tried after them. */
export function upkeepWrites(input: UpkeepInput, tried: Tried): { wake: string[]; forget: string[]; tried: Tried } {
  const wake = sleepersAskingForYou(input).filter((record) => !tried.woken.has(keyOf(record)));
  const forget = openedWoke(input).filter((record) => !tried.forgotten.has(keyOf(record)));
  return {
    wake: wake.map((record) => record.threadId),
    forget: forget.map((record) => record.threadId),
    tried: { woken: withKeys(tried.woken, wake), forgotten: withKeys(tried.forgotten, forget) },
  };
}

// ------------------------------------------------------------------ layer 2

/** The open thread's record once its time has come: seen, so its sleep is over. */
function openedWoke({ sleeps, now, activeThreadId }: UpkeepInput): SleepRecord[] {
  const opened = activeThreadId === null ? undefined : sleeps.get(activeThreadId);
  return opened !== undefined && opened.until <= now ? [opened] : [];
}

function withKeys(keys: ReadonlySet<string>, records: readonly SleepRecord[]): ReadonlySet<string> {
  return records.length === 0 ? keys : new Set([...keys, ...records.map(keyOf)]);
}

/** A new sleep of the same thread has a new key, so it is written afresh. */
function keyOf(record: SleepRecord): string {
  return `${record.threadId}@${record.until}`;
}
