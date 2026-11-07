// A PR's review state, derived on every read and never stored: from its guides and runs
// (plugin storage), the status of their threads (bb) and its current head (GitHub). Pure.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ReviewState } from "../contract.ts";
import type { GuideHead, ReviewRun } from "./store.ts";

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];
/** What derivation reads of a run's thread. */
export type ThreadFacts = Pick<ThreadRow, "status" | "updatedAt">;

export type ReviewFacts = {
  /** The PR's current head commit. */
  headSha: string;
  /** This PR's guides, for any head. */
  guides: GuideHead[];
  /** This PR's runs, for any head. */
  runs: ReviewRun[];
  /** Status of the run threads that still exist; an archived or deleted thread's run no longer counts. */
  threads: ReadonlyMap<string, ThreadFacts>;
};

export type RunningReview = Extract<ReviewState, { kind: "running" }>;

// A thread that is still working, or about to.
const BUSY: ReadonlySet<ThreadFacts["status"]> = new Set(["starting", "pending", "active", "stopping"]);

export function deriveReviewState({ headSha, guides, runs, threads }: ReviewFacts): ReviewState {
  // First, so a thread answering a question about its guide does not read as writing one.
  const current = guides.find((guide) => guide.key.headSha === headSha);
  if (current !== undefined) return { kind: "ready", threadId: current.threadId, guideHeadSha: headSha };

  const running = deriveRunningReview({ guides, runs, threads });
  if (running !== null) return running;

  // Only a run for the current head explains a missing guide; an older head's run is history.
  const settled = openRunsNewestFirst({ guides, runs, threads }).find(({ run }) => run.key.headSha === headSha);
  if (settled !== undefined) return { kind: "no-guide", threadId: settled.run.threadId, idleSince: settled.thread.updatedAt };

  const latest = newestFirst(guides)[0];
  if (latest !== undefined) return { kind: "stale", threadId: latest.threadId, guideHeadSha: latest.key.headSha };

  return { kind: "none" };
}

/** The review a thread is writing now, for any head: the newest open run, while its thread is busy. Needs no GitHub read. */
export function deriveRunningReview(facts: Omit<ReviewFacts, "headSha">): RunningReview | null {
  const newest = openRunsNewestFirst(facts)[0];
  if (newest === undefined || !BUSY.has(newest.thread.status)) return null;
  return { kind: "running", threadId: newest.run.threadId, runHeadSha: newest.run.key.headSha, startedAt: newest.run.requestedAt };
}

// A run is open while its thread still exists and its head has no guide.
function openRunsNewestFirst({ guides, runs, threads }: Omit<ReviewFacts, "headSha">) {
  const guided = new Set(guides.map((guide) => guide.key.headSha));
  return runs
    .flatMap((run) => {
      const thread = threads.get(run.threadId);
      return thread === undefined || guided.has(run.key.headSha) ? [] : [{ run, thread }];
    })
    .sort((a, b) => b.run.requestedAt - a.run.requestedAt);
}

const newestFirst = (guides: GuideHead[]) => [...guides].sort((a, b) => b.submittedAt - a.submittedAt);
