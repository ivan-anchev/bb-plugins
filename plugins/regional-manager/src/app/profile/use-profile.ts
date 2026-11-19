// A regional manager's profile, as the user sees it: its thread's title as bb shows it, and what the plugin keeps.
import { experimental_useRpcQuery, experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** The regional manager's profile, once both reads have it. */
export function useProfile(coordinatorId: CoordinatorId): Profile | null {
  const coordinators = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  const { threads } = useSidebarThreads();
  const coordinator = coordinators.data?.coordinators.find((listed) => listed.id === coordinatorId);
  const thread = threads.find((listed) => listed.id === coordinator?.threadId);
  return coordinator === undefined || thread === undefined ? null : { name: thread.displayTitle, description: coordinator.description, avatar: coordinator.avatar };
}
