// Everything PR Reviews does to review threads: start one, cancel it, nudge it. Each action
// reads the PR's review state first, so the "which thread, which head" rules live only in
// review-state.ts, and ends by refreshing the repo's reads.
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import { repoTag } from "../contract.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import type { snapshotPrDiff } from "../github/gh.ts";
import type { fetchPrCommits } from "../github/pr-commits.ts";
import type { Repo } from "../github/repo.ts";
import { nudgeMessage, reviewPrompt } from "./prompt.ts";
import type { ReviewReader } from "./review-reader.ts";
import type { ReviewSettings } from "./settings.ts";
import type { Store } from "./store.ts";

// bb has no read-only mode. accept-edits asks a person to approve each escalation, which
// stalls an unattended review; full drops the sandbox. auto keeps the workspace sandbox and
// has the provider review escalations itself.
const REVIEW_PERMISSION_MODE = "auto";

/** One PR of one bb project. */
export type PrRef = { projectId: string; repo: Repo; number: number };

type Threads = BbPluginApi["sdk"]["threads"];

/** The fields of a project's checkout that Start reads. */
interface Checkout {
  path: string;
  hostId: string;
  isDefault: boolean;
}

// The parts of bb and of the other server modules that review actions use, down to the
// fields they read.
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
  store: Pick<Store, "saveRun" | "deleteRun">;
  settings: Pick<ReviewSettings, "get">;
  reader: Pick<ReviewReader, "pullRequest" | "runningReview">;
  github: { snapshotPrDiff: typeof snapshotPrDiff; fetchPrCommits: typeof fetchPrCommits };
};

export type Reviews = ReturnType<typeof createReviews>;

export function createReviews({ bb, store, settings, reader, github }: Deps) {
  const refresh = (repo: Repo) => bb.rpc.experimental_invalidate([repoTag(repo)]);

  // A second Start while one is in flight for the same PR joins it, so a double click spawns
  // one thread. Once a start lands, its run makes the PR read as running.
  const starting = new Map<string, Promise<{ threadId: string }>>();

  function start(ref: PrRef): Promise<{ threadId: string }> {
    const key = `${ref.repo}#${ref.number}`;
    const inFlight = starting.get(key);
    if (inFlight !== undefined) return inFlight;
    const started = startThread(ref).finally(() => starting.delete(key));
    starting.set(key, started);
    return started;
  }

  async function startThread({ projectId, repo, number }: PrRef): Promise<{ threadId: string }> {
    const { pr, review } = await reader.pullRequest(repo, number);
    if (review.kind === "running") return { threadId: review.threadId };
    if (review.kind === "ready") throw new Refusal({ code: "conflict", message: "This PR already has a guide for its current commit." });

    const checkout = await localDefaultCheckoutOf(projectId);
    const { headSha, baseSha, diff } = await github.snapshotPrDiff(repo, number);
    await github.fetchPrCommits(checkout.path, number, { headSha, baseSha });
    const { instructions } = await settings.get();
    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: newWorktreeOn(checkout.hostId),
      title: `Review #${number}: ${pr.title}`,
      pluginMetadata: { repo, number, headSha },
      permissionMode: REVIEW_PERMISSION_MODE,
      prompt: reviewPrompt({ repo, pr, headSha, baseSha, files: parsePrDiff(diff) }, instructions),
    });
    store.saveRun({ key: { repo, number, headSha }, threadId: thread.id, requestedAt: Date.now() }, diff);
    refresh(repo);
    return { threadId: thread.id };
  }

  // bb makes review worktrees from the project's default checkout, and the PR's commits are
  // fetched into that checkout's repository first. The fetch runs git on the machine running bb
  // (bb's primary host), so a checkout on another machine is refused before anything runs.
  async function localDefaultCheckoutOf(projectId: string) {
    const [project, { primaryHostId }] = await Promise.all([bb.sdk.projects.get({ projectId }), bb.sdk.system.config()]);
    const checkout = project.sources.find((source) => source.isDefault);
    if (checkout === undefined) throw new Refusal({ code: "invalid", message: "This project has no default checkout to make a review worktree from." });
    if (checkout.hostId !== primaryHostId) {
      throw new Refusal({ code: "invalid", message: "PR Reviews can only review a project whose default checkout is on the machine running bb. This project's default checkout is on another machine." });
    }
    return checkout;
  }

  // A fresh worktree of the default branch, never the user's own environment, on the default
  // checkout's machine.
  const newWorktreeOn = (hostId: string) => ({ type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }) as const;

  // Reads only local runs and bb's thread status, so Cancel works while GitHub is unreachable.
  // The run is withdrawn only once bb confirms the stop: a failed stop keeps it, so the PR still
  // reads as running and another Cancel retries. Either way the page re-reads.
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

  // The thread turns active on the message, and its thread.active event shows the PR as running.
  async function nudge({ repo, number }: PrRef): Promise<void> {
    const { review } = await reader.pullRequest(repo, number);
    if (review.kind !== "no-guide") throw new Refusal({ code: "conflict", message: "The review thread isn't waiting to be asked." });
    await bb.sdk.threads.send({ threadId: review.threadId, input: [{ type: "text", text: nudgeMessage(), mentions: [] }], mode: "queue-if-active" });
    refresh(repo);
  }

  return { start, cancel, nudge };
}
