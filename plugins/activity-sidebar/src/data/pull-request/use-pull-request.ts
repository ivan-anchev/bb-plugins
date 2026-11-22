import { experimental_useRpcKeyedQuery as useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { githubPrStatus, shownPullRequest, type PullRequest } from "./github-pr-status.ts";

/**
 * The environment's pull request; null without an environment, while it loads, when the read failed,
 * or when there is none to show. A failed refresh keeps the row last read (the host retains it).
 */
export function usePullRequest(environmentId: string | null): PullRequest | null {
  const { data } = useRpcKeyedQuery({
    pluginId: "bb--github-pr-status",
    contract: githubPrStatus,
    method: "pullRequests",
    keys: environmentId === null ? [] : [environmentId],
  });
  return environmentId === null ? null : shownPullRequest(data?.[environmentId]);
}
