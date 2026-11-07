// Typed hooks over the contract. The same method and input share one cache entry, so the
// sidebar, the page and the Refresh button read, and refetch, the same data.
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { prReviewsContract as contract } from "../contract.ts";

export const useProjects = () => experimental_useRpcQuery({ contract, method: "projects", input: {} });

/** A null project reads nothing: the read stays disabled until there is one. */
export const usePullRequests = (projectId: string | null) =>
  experimental_useRpcQuery({ contract, method: "pullRequests", input: { projectId: projectId ?? "" }, enabled: projectId !== null });

export const usePullRequest = (projectId: string, number: number) =>
  experimental_useRpcQuery({ contract, method: "pullRequest", input: { projectId, number } });

/** One PR's guide for one head commit. */
export type GuideTarget = { projectId: string; number: number; headSha: string };

export const useGuide = (target: GuideTarget) => experimental_useRpcQuery({ contract, method: "guide", input: target });

export const useSelectProject = () => experimental_useRpcMutation({ contract, method: "selectProject" });

type ReviewAction = "startReview" | "cancelReview" | "nudgeReview";
export const useReviewAction = (method: ReviewAction) => experimental_useRpcMutation({ contract, method });

export const useAskAboutFinding = () => experimental_useRpcMutation({ contract, method: "askAboutFinding" });
