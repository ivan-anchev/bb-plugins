// Typed hooks over the contract. The same method and input share one cache entry, so the
// sidebar, the page and the Refresh button read, and refetch, the same data.
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { prReviewsContract as contract, type FileAtCommit } from "../contract.ts";

export const useProjects = () => experimental_useRpcQuery({ contract, method: "projects", input: {} });

/** A null project reads nothing: the read stays disabled until there is one. */
export const usePullRequests = (projectId: string | null) =>
  experimental_useRpcQuery({ contract, method: "pullRequests", input: { projectId: projectId ?? "" }, enabled: projectId !== null });

export const usePullRequest = (projectId: string, number: number) =>
  experimental_useRpcQuery({ contract, method: "pullRequest", input: { projectId, number } });

/** The PR a page or action is about. */
export type PrTarget = { projectId: string; number: number };

/** A PR at one head commit: the commit a guide is for, or the one the Changes tab's diff was read at. */
export type PrHeadTarget = PrTarget & { headSha: string };

export const useGuide = (target: PrHeadTarget) => experimental_useRpcQuery({ contract, method: "guide", input: target });

/** The PR's whole diff. `enabled` stays false until the Changes tab is first shown, since the read runs `gh pr diff`. */
export const useChanges = (target: PrTarget, enabled: boolean) => experimental_useRpcQuery({ contract, method: "changes", input: target, enabled });

/** One file's text at a commit. `enabled`: false reads nothing, for a file whose diff can't expand. */
export const useFileContent = (input: FileAtCommit, enabled: boolean) => experimental_useRpcQuery({ contract, method: "fileContent", input, enabled });

export const useSelectProject = () => experimental_useRpcMutation({ contract, method: "selectProject" });

type ReviewAction = "startReview" | "cancelReview" | "nudgeReview" | "updateGuide";

// One review action on one PR. The hook's error state reports a failed write beside the
// buttons; the rejection itself carries nothing more.
export function useReviewAction(method: ReviewAction, target: PrTarget) {
  const action = experimental_useRpcMutation({ contract, method });
  const run = () => void action.mutate(target).catch(() => undefined);
  return { run, isPending: action.isPending, error: action.error };
}

export const useAskAboutFinding = () => experimental_useRpcMutation({ contract, method: "askAboutFinding" });
