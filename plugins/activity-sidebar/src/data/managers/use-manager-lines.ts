// The regional managers' lines, as the server last read them from their threads; read again whenever
// one changes (server/managers/manager-lines.ts), and as managers come and go.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { activitySidebarContract } from "../../contract.ts";
import type { ManagerLine } from "../../model/manager-line.ts";

const NONE: readonly ManagerLine[] = [];

/** The line of each manager in `threadIds` that has one; none until the first read, and none with no managers. */
export function useManagerLines(threadIds: readonly string[]): readonly ManagerLine[] {
  const read = experimental_useRpcQuery({ contract: activitySidebarContract, method: "managerLines", input: { threadIds: [...threadIds] }, enabled: threadIds.length > 0 });
  return read.data?.lines ?? NONE;
}
