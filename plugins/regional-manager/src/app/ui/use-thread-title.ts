// A regional manager's title, as bb shows it.
import { experimental_useRpcQuery, experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** The regional manager's title, once both reads have it. */
export function useThreadTitle(coordinatorId: CoordinatorId): string | null {
  const coordinators = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  const { threads } = useSidebarThreads();
  const threadId = coordinators.data?.coordinators.find((coordinator) => coordinator.id === coordinatorId)?.threadId;
  return threads.find((thread) => thread.id === threadId)?.displayTitle ?? null;
}
