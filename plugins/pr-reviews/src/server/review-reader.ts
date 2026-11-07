// Reads PRs with their review state: one guides query, one runs query and one thread-status
// read for a whole list, then the pure derivation per PR. A PR's running review needs no
// GitHub read at all.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PrDetail, PrSummary, ReviewState } from "../contract.ts";
import { viewPr } from "../github/gh.ts";
import type { Repo } from "../github/repo.ts";
import { deriveReviewState, deriveRunningReview, type RunningReview, type ThreadFacts } from "./review-state.ts";
import type { Store } from "./store.ts";

// bb's limit on threadIds per threads.list call.
const THREAD_IDS_PER_LIST = 200;

type PrHead = Pick<PrSummary, "number" | "headSha">;

export type ReviewReader = ReturnType<typeof createReviewReader>;

export function createReviewReader({ bb, store }: { bb: BbPluginApi; store: Store }) {
  async function withReviews<P extends PrHead>(repo: Repo, prs: P[]): Promise<(P & { review: ReviewState })[]> {
    const numbers = prs.map((pr) => pr.number);
    const guides = store.guideHeadsFor(repo, numbers);
    const runs = store.runsFor(repo, numbers);
    const threads = await threadFacts(runs.map((run) => run.threadId));
    return prs.map((pr) => ({
      ...pr,
      review: deriveReviewState({ headSha: pr.headSha, guides: ofPr(guides, pr.number), runs: ofPr(runs, pr.number), threads }),
    }));
  }

  async function pullRequest(repo: Repo, number: number): Promise<{ pr: PrDetail; review: ReviewState }> {
    const [{ review, ...pr }] = await withReviews(repo, [await viewPr(repo, number)]);
    return { pr, review };
  }

  async function runningReview(repo: Repo, number: number): Promise<RunningReview | null> {
    const runs = store.runsFor(repo, [number]);
    return deriveRunningReview({ guides: store.guideHeadsFor(repo, [number]), runs, threads: await threadFacts(runs.map((run) => run.threadId)) });
  }

  // Threads that still exist and are not archived; hidden ones too, since a user may hide a
  // review thread from the sidebar without abandoning it.
  async function threadFacts(threadIds: string[]): Promise<ReadonlyMap<string, ThreadFacts>> {
    const pages = await Promise.all(
      chunks([...new Set(threadIds)], THREAD_IDS_PER_LIST).map((ids) => bb.sdk.threads.list({ threadIds: ids, archived: false, includeHidden: true })),
    );
    return new Map(pages.flat().map((thread) => [thread.id, { status: thread.status, updatedAt: thread.updatedAt }]));
  }

  return { withReviews, pullRequest, runningReview };
}

const ofPr = <Row extends { key: { number: number } }>(rows: Row[], number: number) => rows.filter((row) => row.key.number === number);

const chunks = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
