// Typed hooks over the contract. The same method and input share one cache entry, so the
// sidebar, the page and the Refresh button read, and refetch, the same data.
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { prReviewsContract as contract } from "../contract.ts";

export const useProjects = () => experimental_useRpcQuery({ contract, method: "projects", input: {} });

export const usePullRequests = (projectId: string) => experimental_useRpcQuery({ contract, method: "pullRequests", input: { projectId } });

export const usePullRequest = (projectId: string, number: number) =>
  experimental_useRpcQuery({ contract, method: "pullRequest", input: { projectId, number } });

export const useSelectProject = () => experimental_useRpcMutation({ contract, method: "selectProject" });

type ReviewAction = "startReview" | "cancelReview" | "nudgeReview";
export const useReviewAction = (method: ReviewAction) => experimental_useRpcMutation({ contract, method });
