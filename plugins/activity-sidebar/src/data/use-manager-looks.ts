// The regional managers' avatars and descriptions, as the server last read them from the Regional
// Manager plugin; read again when a manager's thread changes and every minute (server/manager-looks.ts).
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { activitySidebarContract } from "../contract.ts";
import type { ManagerLook } from "../model/manager-look.ts";

const NONE: readonly ManagerLook[] = [];

/**
 * Every known look; none until the first read, and none while there are no managers to draw, so a bb
 * without regional managers never asks for them.
 */
export function useManagerLooks(hasManagers: boolean): readonly ManagerLook[] {
  const read = experimental_useRpcQuery({ contract: activitySidebarContract, method: "managerLooks", input: {}, enabled: hasManagers });
  return read.data?.looks ?? NONE;
}
