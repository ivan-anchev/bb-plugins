// A PR's review state, derived on every read and never stored: from its runs (plugin
// storage), the status of their threads (bb) and its current head (GitHub). Pure.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ReviewState } from "../contract.ts";
import type { ReviewRun } from "./store.ts";

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];
/** What derivation reads of a run's thread. */
export type ThreadFacts = Pick<ThreadRow, "status" | "updatedAt">;

export type ReviewFacts = {
  /** The PR's current head commit. */
  headSha: string;
  /** This PR's runs, for any head. */
  runs: ReviewRun[];
  /** Status of the run threads that still exist; an archived or deleted thread's run no longer counts. */
  threads: ReadonlyMap<string, ThreadFacts>;
};

export type RunningReview = Extract<ReviewState, { kind: "running" }>;

// A thread that is still working, or about to.
const BUSY: ReadonlySet<ThreadFacts["status"]> = new Set(["starting", "pending", "active", "stopping"]);

export function deriveReviewState({ headSha, runs, threads }: ReviewFacts): ReviewState {
  const running = deriveRunningReview({ runs, threads });
  if (running !== null) return running;

  // Only a run for the current head explains a missing guide; an older head's run is history.
  const settled = liveRunsNewestFirst(runs, threads).find(({ run }) => run.key.headSha === headSha);
  if (settled !== undefined) return { kind: "no-guide", threadId: settled.run.threadId, idleSince: settled.thread.updatedAt };

  return { kind: "none" };
}

/** The review a thread is writing now, for any head: the newest live run, while its thread is busy. Needs no GitHub read. */
export function deriveRunningReview({ runs, threads }: Omit<ReviewFacts, "headSha">): RunningReview | null {
  const newest = liveRunsNewestFirst(runs, threads)[0];
  if (newest === undefined || !BUSY.has(newest.thread.status)) return null;
  return { kind: "running", threadId: newest.run.threadId, runHeadSha: newest.run.key.headSha, startedAt: newest.run.requestedAt };
}

function liveRunsNewestFirst(runs: ReviewRun[], threads: ReviewFacts["threads"]) {
  return runs
    .flatMap((run) => {
      const thread = threads.get(run.threadId);
      return thread === undefined ? [] : [{ run, thread }];
    })
    .sort((a, b) => b.run.requestedAt - a.run.requestedAt);
}
