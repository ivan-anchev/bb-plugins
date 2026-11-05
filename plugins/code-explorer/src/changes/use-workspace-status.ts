import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { gitContract, type StatusRow, type WorkspaceStatus } from "../git.ts";

export type WorkspaceStatusState =
  | { kind: "loading" }
  | { kind: "notice"; tone: "quiet" | "error"; message: string }
  | { kind: "ready"; workspace: WorkspaceStatus };

export function useWorkspaceStatus(environmentId: string) {
  const { data, error, refetch } = experimental_useRpcKeyedQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "status",
    keys: [environmentId],
  });
  const row = data?.[environmentId];
  const state = row === undefined ? pendingStateOf(error) : stateOf(row);
  return { state, refreshError: row === undefined || error === null ? null : error.message, refetch };
}

function pendingStateOf(error: { message: string } | null): WorkspaceStatusState {
  return error === null
    ? { kind: "loading" }
    : { kind: "notice", tone: "error", message: `Could not read the git status: ${error.message}` };
}

function stateOf(row: StatusRow): WorkspaceStatusState {
  switch (row.outcome) {
    case "available":
      return { kind: "ready", workspace: row.workspace };
    case "not_applicable":
      return { kind: "notice", tone: "quiet", message: row.message };
    case "unavailable":
      return { kind: "notice", tone: "error", message: row.failure.message };
    case "failed":
      return { kind: "notice", tone: "error", message: row.message };
  }
}
