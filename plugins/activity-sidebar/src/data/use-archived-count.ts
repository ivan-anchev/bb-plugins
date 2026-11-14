// The Archived shelf's true count for the chosen project, live across clients, and its read again.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { activitySidebarContract } from "../contract.ts";
import { archivedCountFor, type ArchivedCountState } from "../list/items.ts";

type ArchivedCountRead = { count: ArchivedCountState; refetch(): void };

/** Archived parents in `filter` (a project id, or null for every project), and a Retry for a failed read. */
export function useArchivedCount(filter: string | null): ArchivedCountRead {
  const read = experimental_useRpcQuery({ contract: activitySidebarContract, method: "archivedCount", input: {} });
  return { count: archivedCountFor(read, filter), refetch: () => void read.refetch() };
}
