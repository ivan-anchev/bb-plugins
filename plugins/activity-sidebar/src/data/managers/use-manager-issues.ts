// A manager's open work while its card shows, as the server last read it from the Regional Manager
// plugin; read again when one of that plugin's threads moves and every minute (server/managers/manager-issues.ts).
// The read is kept between cards, so a card opened again shows what it last listed at once.
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { activitySidebarContract } from "../../contract.ts";
import type { ManagerIssues } from "../../model/manager-issues.ts";

/** The open work of the manager `id`; null with no id (its look unknown), until the first read, or when the read failed. */
export function useManagerIssues(id: string | null): ManagerIssues | null {
  const keys = useMemo(() => (id === null ? [] : [id]), [id]);
  const read = experimental_useRpcKeyedQuery({ contract: activitySidebarContract, method: "managerIssues", keys, enabled: id !== null });
  return id === null ? null : (read.data?.[id] ?? null);
}
