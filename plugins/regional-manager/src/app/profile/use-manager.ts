// A regional manager as the panel shows it: started, its name its thread's title as bb shows it; or
// not started yet, its name the plugin's. Its description and avatar are the plugin's either way.
import { experimental_useRpcQuery, experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../../contract.ts";
import type { Avatar } from "../../model/profile/avatar.ts";
import type { Profile } from "../../model/profile/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** `profile` of a started one: null while bb lists its thread no more (archived), which names it. */
type Manager = { kind: "started"; threadId: string; profile: Profile | null } | { kind: "not-started"; profile: Profile };

/** The regional manager, once the plugin's read has it; null before, when there is none by that id, or for no id. */
export function useManager(coordinatorId: CoordinatorId | null): Manager | null {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  const { threads } = useSidebarThreads();
  const waiting = read.data?.notStarted.find(({ id }) => id === coordinatorId);
  if (waiting !== undefined) return { kind: "not-started", profile: { name: waiting.name, description: waiting.description, avatar: waiting.avatar } };
  const started = read.data?.coordinators.find(({ id }) => id === coordinatorId);
  if (started === undefined) return null;
  const thread = threads.find(({ id }) => id === started.threadId);
  return { kind: "started", threadId: started.threadId, profile: thread === undefined ? null : { name: thread.displayTitle, description: started.description, avatar: started.avatar } };
}

/**
 * The looks every regional manager has, started or not, from the same read as the panel's list.
 * `looks` is null until that read first answers; after a later read fails it is the list read last,
 * which may lack a look taken since. `error` is the last read's failure, and `retry` reads again.
 */
export function useTakenLooks(): { looks: Avatar[] | null; error: Error | null; retry(): void } {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  return {
    looks: read.data === undefined ? null : [...read.data.coordinators, ...read.data.notStarted].map(({ avatar }) => avatar),
    error: read.error,
    retry: () => void read.refetch(),
  };
}

/** The started regional manager whose thread this is, from the same read as the panel's list; null for any other thread, or before the read. */
export function useCoordinatorOfThread(threadId: string) {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  return { read, coordinator: read.data?.coordinators.find((coordinator) => coordinator.threadId === threadId) ?? null };
}

/** Whether the thread is a started regional manager's, which alone has its tabs (the Board, an issue's). */
export const useIsManagerThread = ({ threadId }: { threadId: string }): boolean => useCoordinatorOfThread(threadId).coordinator !== null;
