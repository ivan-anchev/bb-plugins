// Every thread's sleep, live across clients, and the writes that change one.
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { toast } from "sonner";
import { activitySidebarContract, type SleepRecord } from "../contract.ts";
import { sleepsStatus, type SleepsStatus } from "../list/items.ts";
import { syncMinute } from "./use-minute.ts";

export type Sleeps = {
  sleeps: ReadonlyMap<string, SleepRecord>;
  status: SleepsStatus;
  refetch(): void;
  /** Asleep until a future `until`; a refusal says so. */
  sleep(threadId: string, until: number): void;
  /** Awake now, woke now; a refusal says so. */
  wake(threadId: string): void;
  /** The sleep forgotten, so its Woke glyph goes; a refusal says so. */
  forget(threadId: string): void;
};

const NONE: readonly SleepRecord[] = [];

export function useSleeps(): Sleeps {
  const read = experimental_useRpcQuery({ contract: activitySidebarContract, method: "sleeps", input: {} });
  const write = experimental_useRpcMutation({
    contract: activitySidebarContract,
    method: "setSleep",
    // why: the row moves the moment Sleep or Wake is picked. Pure: the caller stamps `until`.
    optimistic: (input, cache) =>
      cache.update("sleeps", {}, (current) => ({
        sleeps: [...current.sleeps.filter((s) => s.threadId !== input.threadId), ...(input.until === null ? [] : [{ threadId: input.threadId, until: input.until }])],
      })),
  });

  const records = read.data?.sleeps ?? NONE;
  const sleeps = useMemo(() => new Map(records.map((s) => [s.threadId, s])), [records]);
  const setSleep = (threadId: string, until: number | null) => write.mutate({ threadId, until });
  // A write the server refused says so: never a click, or a wake, that silently undoes itself (Z:screens/shell/activity.luau:70-82).
  const said = (title: string) => () => void toast.error(title);
  return {
    sleeps,
    status: sleepsStatus(read),
    refetch: () => void read.refetch(),
    sleep: (threadId, until) => void setSleep(threadId, until).catch(said("Couldn't put this chat to sleep")),
    // why: the shared clock moves to the stamp, so the row reads as woken on this render, not a minute on.
    wake: (threadId) => void setSleep(threadId, syncMinute()).catch(said("Couldn't wake this chat")),
    forget: (threadId) => void setSleep(threadId, null).catch(said("Couldn't mark this chat as seen")),
  };
}
