// The regional managers' lines, as the server last read them from their threads; read again whenever
// one changes (server/manager-lines.ts).
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { activitySidebarContract } from "../../contract.ts";
import type { ManagerLine } from "../../model/manager-line.ts";

const NONE: readonly ManagerLine[] = [];

/** Every known line; none until the first read, and none while there are no managers to draw. */
export function useManagerLines(hasManagers: boolean): readonly ManagerLine[] {
  const read = experimental_useRpcQuery({ contract: activitySidebarContract, method: "managerLines", input: {}, enabled: hasManagers });
  return read.data?.lines ?? NONE;
}
