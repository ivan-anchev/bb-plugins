import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { CodeQuote } from "../comments/comment-schema.ts";
import type { ReviewThread } from "../comments/thread-schema.ts";
import { repoTag, reviewThreadOf, type PrDetail, type PrHeadKey, type ReviewState } from "../contract.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import type { PrDiffSnapshot, snapshotPrDiff } from "../github/gh.ts";
import type { fetchPrCommits } from "../github/pr-commits.ts";
import type { Repo } from "../github/repo.ts";
import { askMessage, linesQuestionMessage, nudgeMessage, reviewPrompt, threadQuestionMessage, updateMessage, type PromptFacts } from "./prompt.ts";
import type { ReviewReader } from "./review-reader.ts";
import type { ReviewSettings } from "./settings.ts";
import type { Store } from "./store.ts";

const REVIEW_PERMISSION_MODE = "auto";

const REVIEW_THREAD_VISIBILITY = "hidden";

/** One PR of one bb project. */
export type PrRef = { projectId: string; repo: Repo; number: number };

type Threads = BbPluginApi["sdk"]["threads"];

type Stale = Extract<ReviewState, { kind: "stale" }>;

/** The fields of a project's checkout that Start reads. */
interface Checkout {
  path: string;
  hostId: string;
  isDefault: boolean;
}

type Bb = {
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  sdk: {
    threads: Pick<Threads, "stop" | "send"> & { spawn(args: Parameters<Threads["spawn"]>[0]): Promise<{ id: string }> };
    projects: { get(args: { projectId: string }): Promise<{ sources: readonly Checkout[] }> };
    /** `primaryHostId` is the machine bb's server, and so this plugin's git, runs on. */
    system: { config(): Promise<{ primaryHostId: string | null }> };
  };
};

type Deps = {
  bb: Bb;
  store: Pick<Store, "saveRun" | "deleteRun" | "guide">;
  settings: Pick<ReviewSettings, "get">;
  reader: Pick<ReviewReader, "pullRequest" | "runningReview" | "threadIsOpen">;
  github: { snapshotPrDiff: typeof snapshotPrDiff; fetchPrCommits: typeof fetchPrCommits };
};

export type Reviews = ReturnType<typeof createReviews>;

export function createReviews({ bb, store, settings, reader, github }: Deps) {
  const refresh = (repo: Repo) => bb.rpc.experimental_invalidate([repoTag(repo)]);
  const send = (threadId: string, text: string) =>
    bb.sdk.threads.send({ threadId, input: [{ type: "text", text, mentions: [] }], mode: "queue-if-active" });

  const inFlight = new Map<string, Promise<{ threadId: string }>>();

  function once(ref: PrRef, action: (ref: PrRef) => Promise<{ threadId: string }>): Promise<{ threadId: string }> {
    const key = `${ref.repo}#${ref.number}`;
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const started = action(ref).finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  }

  const start = (ref: PrRef) => once(ref, startReview);
  const update = (ref: PrRef) => once(ref, updateGuide);

  async function startReview(ref: PrRef): Promise<{ threadId: string }> {
    const { pr, review } = await reader.pullRequest(ref.repo, ref.number);
    if (review.kind === "running") return { threadId: review.threadId };
    if (review.kind === "ready") throw new Refusal({ code: "conflict", message: "This PR already has a guide for its current commit." });
    return spawnReview(ref, pr);
  }

  async function updateGuide(ref: PrRef): Promise<{ threadId: string }> {
    const { pr, review } = await reader.pullRequest(ref.repo, ref.number);
    if (review.kind === "running") return { threadId: review.threadId };
    if (review.kind !== "stale") throw new Refusal({ code: "conflict", message: "Only a guide written for an older commit can be updated." });
    if (!(await reader.threadIsOpen(review.threadId))) return spawnReview(ref, pr);
    return messageReview(ref, pr, review);
  }

  async function spawnReview({ projectId, repo, number }: PrRef, pr: PrDetail): Promise<{ threadId: string }> {
    const { checkout, snapshot } = await pinPrDiff(projectId, repo, number);
    const { instructions } = await settings.get();
    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: newWorktreeOn(checkout.hostId),
      title: `Review #${number}: ${pr.title}`,
      pluginMetadata: { repo, number, headSha: snapshot.headSha },
      permissionMode: REVIEW_PERMISSION_MODE,
      visibility: REVIEW_THREAD_VISIBILITY,
      prompt: reviewPrompt(promptFacts(repo, pr, snapshot), instructions),
    });
    return saveRun(repo, number, thread.id, snapshot);
  }

  async function messageReview({ projectId, repo, number }: PrRef, pr: PrDetail, stale: Stale): Promise<{ threadId: string }> {
    const { snapshot } = await pinPrDiff(projectId, repo, number);
    await send(stale.threadId, updateMessage(promptFacts(repo, pr, snapshot), stale.guideHeadSha));
    return saveRun(repo, number, stale.threadId, snapshot);
  }

  async function pinPrDiff(projectId: string, repo: Repo, number: number) {
    const checkout = await localDefaultCheckoutOf(projectId);
    const snapshot = await github.snapshotPrDiff(repo, number);
    await github.fetchPrCommits(checkout.path, number, snapshot);
    return { checkout, snapshot };
  }

  function saveRun(repo: Repo, number: number, threadId: string, { headSha, diff }: PrDiffSnapshot): { threadId: string } {
    store.saveRun({ key: { repo, number, headSha }, threadId, requestedAt: Date.now() }, diff);
    refresh(repo);
    return { threadId };
  }

  const promptFacts = (repo: Repo, pr: PrDetail, { headSha, baseSha, diff }: PrDiffSnapshot): PromptFacts => ({ repo, pr, headSha, baseSha, files: parsePrDiff(diff) });

  async function localDefaultCheckoutOf(projectId: string) {
    const [project, { primaryHostId }] = await Promise.all([bb.sdk.projects.get({ projectId }), bb.sdk.system.config()]);
    const checkout = project.sources.find((source) => source.isDefault);
    if (checkout === undefined) throw new Refusal({ code: "invalid", message: "This project has no default checkout to make a review worktree from." });
    if (checkout.hostId !== primaryHostId) {
      throw new Refusal({ code: "invalid", message: "PR Reviews can only review a project whose default checkout is on the machine running bb. This project's default checkout is on another machine." });
    }
    return checkout;
  }

  const newWorktreeOn = (hostId: string) => ({ type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }) as const;

  async function cancel({ repo, number }: PrRef): Promise<void> {
    const running = await reader.runningReview(repo, number);
    if (running === null) return;
    try {
      await bb.sdk.threads.stop({ threadId: running.threadId });
      store.deleteRun({ repo, number, headSha: running.runHeadSha });
    } finally {
      refresh(repo);
    }
  }

  async function nudge({ repo, number }: PrRef): Promise<void> {
    const { review } = await reader.pullRequest(repo, number);
    if (review.kind !== "no-guide") throw new Refusal({ code: "conflict", message: "The review thread isn't waiting to be asked." });
    await send(review.threadId, nudgeMessage());
    refresh(repo);
  }

  async function ask(key: PrHeadKey, findingIndex: number, question: string): Promise<void> {
    const record = store.guide(key);
    const finding = record?.guide.findings[findingIndex];
    if (record === null || finding === undefined) throw new Refusal({ code: "not_found", message: "That finding is no longer in the guide." });
    await send(record.threadId, askMessage(finding, question));
  }

  async function askReviewThread({ repo, number }: PrRef, message: string): Promise<void> {
    const { review } = await reader.pullRequest(repo, number);
    const threadId = reviewThreadOf(review);
    if (threadId === null) throw new Refusal({ code: "conflict", message: "This pull request has no review thread yet. Start a review first." });
    await send(threadId, message);
  }

  const askAboutLines = (pr: PrRef, quote: CodeQuote, question: string) => askReviewThread(pr, linesQuestionMessage(quote, question));

  const askAboutGitHubThread = (pr: PrRef, thread: ReviewThread, question: string) => askReviewThread(pr, threadQuestionMessage(thread, question));

  return { start, update, cancel, nudge, ask, askAboutLines, askAboutGitHubThread };
}
