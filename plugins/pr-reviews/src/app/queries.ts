// Typed hooks over the contract. The same method and input share one cache entry, so the
// sidebar, the page and the Refresh button read, and refetch, the same data.
import { useEffect, useState } from "react";
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { prReviewsContract as contract, type FileAtCommit } from "../contract.ts";

/** The sidebar's sections across every project. */
export const useInbox = () => experimental_useRpcQuery({ contract, method: "inbox", input: {} });

/** When, and in which project, the reader last opened each PR. */
export const useVisits = () => experimental_useRpcQuery({ contract, method: "visits", input: {} });

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

/**
 * Every comment GitHub has on the PR. The Changes tab and each guide diff read the same entry; a
 * post re-reads it (its tag), so a new comment or reply shows in place.
 */
export const useComments = (target: PrTarget) => experimental_useRpcQuery({ contract, method: "comments", input: target });

/**
 * Records that the PR's page opened. An effect: the visit is a side effect of showing the page,
 * once per PR shown. A failed write stays in `error`, through any retry still pending, until
 * `retry` records the visit.
 */
export function useRecordVisit({ projectId, number }: PrTarget) {
  const visit = experimental_useRpcMutation({ contract, method: "recordVisit" });
  // why state set while rendering: a new write clears the mutation's error as it starts, and the
  // notice showing it must stay up, with focus on its Try again, until the retry settles.
  const [error, setError] = useState(visit.error);
  if (!visit.isPending && visit.error !== error) setError(visit.error);
  // The hook's error state reports a failure; the rejection itself carries nothing more.
  const record = () => void visit.mutate({ projectId, number }).catch(() => undefined);
  // `record` stays out of the deps: it is new each render, and a new one is no new visit.
  useEffect(record, [projectId, number]);
  return { retry: record, isPending: visit.isPending, error };
}

type ReviewAction = "startReview" | "cancelReview" | "nudgeReview" | "updateGuide";

// One review action on one PR. The hook's error state reports a failed write beside the
// buttons; the rejection itself carries nothing more.
export function useReviewAction(method: ReviewAction, target: PrTarget) {
  const action = experimental_useRpcMutation({ contract, method });
  const run = () => void action.mutate(target).catch(() => undefined);
  return { run, isPending: action.isPending, error: action.error };
}

export const useAskAboutFinding = () => experimental_useRpcMutation({ contract, method: "askAboutFinding" });

export const useAskAboutLines = () => experimental_useRpcMutation({ contract, method: "askAboutLines" });

export const useAskAboutGitHubThread = () => experimental_useRpcMutation({ contract, method: "askAboutGitHubThread" });

export const usePostComment = () => experimental_useRpcMutation({ contract, method: "postComment" });

export const useReplyToThread = () => experimental_useRpcMutation({ contract, method: "replyToThread" });

export const usePostConversationComment = () => experimental_useRpcMutation({ contract, method: "postConversationComment" });

/** Changes a PR's state on GitHub. The server re-reads the PR's repo, so the header and the sidebar row follow. */
export const useChangePrState = () => experimental_useRpcMutation({ contract, method: "changePrState" });
