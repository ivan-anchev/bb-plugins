import assert from "node:assert/strict";
import { test } from "node:test";
import { repoSchema } from "../github/repo.ts";
import { deriveRunningReview, type ThreadFacts } from "./review-state.ts";
import { createReviews, type PrRef } from "./reviews.ts";
import type { ReviewRun } from "./store.ts";
import type { PrDetail, ReviewState } from "../contract.ts";

const repo = repoSchema.parse("ivan-anchev/bb-plugins");
const ref: PrRef = { projectId: "proj_1", repo, number: 23 };
const RUN: ReviewRun = { key: { repo, number: 23, headSha: "head1" }, threadId: "thr_1", requestedAt: 100 };

const notUsedByCancel = async () => assert.fail("Cancel must not call this");

// Cancel with a real running-review derivation over in-memory runs and bb thread status, with
// GitHub unreachable, and a bb whose first `failedStops` stops reject.
function cancelHarness(failedStops: number) {
  let runs = [RUN];
  const threads = new Map<string, ThreadFacts>([[RUN.threadId, { status: "active", updatedAt: 100 }]]);
  const stops: string[] = [];
  const invalidations: (readonly string[])[] = [];

  const reviews = createReviews({
    bb: {
      rpc: { experimental_invalidate: (tags) => void invalidations.push(tags) },
      sdk: {
        threads: {
          spawn: notUsedByCancel,
          send: notUsedByCancel,
          stop: async ({ threadId }) => {
            stops.push(threadId);
            if (stops.length <= failedStops) throw new Error("bb could not stop the thread");
            threads.set(threadId, { status: "idle", updatedAt: 200 });
            return { ok: true };
          },
        },
        projects: { get: notUsedByCancel },
        system: { config: notUsedByCancel },
      },
    },
    store: {
      saveRun: () => assert.fail("Cancel must not save a run"),
      deleteRun: (key) => void (runs = runs.filter((run) => run.key.headSha !== key.headSha)),
    },
    settings: { get: notUsedByCancel },
    reader: {
      pullRequest: async () => assert.fail("gh: could not reach api.github.com"),
      runningReview: async () => deriveRunningReview({ guides: [], runs, threads }),
    },
    github: { snapshotPrDiff: notUsedByCancel, fetchPrCommits: notUsedByCancel },
  });

  return { reviews, stops, invalidations, runs: () => runs };
}

test("Cancel stops the running thread and withdraws its run without reading GitHub", async () => {
  const { reviews, stops, invalidations, runs } = cancelHarness(0);
  await reviews.cancel(ref);
  assert.deepEqual(stops, ["thr_1"]);
  assert.deepEqual(runs(), []);
  assert.deepEqual(invalidations, [["repo:ivan-anchev/bb-plugins"]]);
});

test("a failed stop keeps the run, refreshes the page, and a second Cancel retries until it stops", async () => {
  const { reviews, stops, invalidations, runs } = cancelHarness(1);

  await assert.rejects(reviews.cancel(ref), /bb could not stop the thread/);
  assert.deepEqual(runs(), [RUN], "the run is the only way to find the thread again");
  assert.equal(invalidations.length, 1);

  await reviews.cancel(ref);
  assert.deepEqual(stops, ["thr_1", "thr_1"]);
  assert.deepEqual(runs(), []);
  assert.equal(invalidations.length, 2);
});

test("a Cancel after the thread stopped does nothing", async () => {
  const { reviews, stops, invalidations } = cancelHarness(0);
  await reviews.cancel(ref);
  await reviews.cancel(ref);
  assert.deepEqual(stops, ["thr_1"]);
  assert.equal(invalidations.length, 1);
});

const SERVER_HOST = "host_server";
const PR: PrDetail = {
  number: 23,
  title: "Fixture",
  author: "ivan-anchev",
  updatedAt: "2026-11-06T00:00:00Z",
  headSha: "head1",
  body: "",
  url: "https://github.com/ivan-anchev/bb-plugins/pull/23",
  headRefName: "fixture/pr-reviews-live",
  baseRefName: "main",
  state: "OPEN",
  commits: ["head1"],
};
const DIFF = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";

// Start with the PR in `review`, the project's default checkout on `checkoutHost`, and every
// GitHub read, fetch, and spawn recorded in order.
function startHarness(checkoutHost: string, review: ReviewState = { kind: "none" }) {
  const calls: string[] = [];
  const reviews = createReviews({
    bb: {
      rpc: { experimental_invalidate: () => undefined },
      sdk: {
        threads: {
          spawn: async ({ environment }) => {
            calls.push(`spawn on ${environment.type === "host" ? environment.hostId : environment.type}`);
            return { id: "thr_new" };
          },
          send: async () => assert.fail("Start must not message a thread"),
          stop: async () => assert.fail("Start must not stop a thread"),
        },
        projects: { get: async () => ({ sources: [{ path: "/repos/bb-plugins", hostId: checkoutHost, isDefault: true }] }) },
        system: { config: async () => ({ primaryHostId: SERVER_HOST }) },
      },
    },
    store: { saveRun: () => void calls.push("save run"), deleteRun: () => assert.fail("Start must not delete a run") },
    settings: { get: async () => ({ instructions: "" }) },
    reader: {
      pullRequest: async () => ({ pr: PR, review }),
      runningReview: async () => assert.fail("Start reads the review through pullRequest"),
    },
    github: {
      snapshotPrDiff: async () => {
        calls.push("snapshot diff");
        return { headSha: "head1", baseSha: "base1", diff: DIFF };
      },
      fetchPrCommits: async (path) => void calls.push(`fetch into ${path}`),
    },
  });
  return { reviews, calls };
}

test("Start refuses a default checkout on another machine before reading the diff, fetching, or spawning", async () => {
  const { reviews, calls } = startHarness("host_remote");
  await assert.rejects(reviews.start(ref), /default checkout is on the machine running bb/);
  assert.deepEqual(calls, []);
});

test("Start on the server's own machine fetches the PR's commits, then spawns there", async () => {
  const { reviews, calls } = startHarness(SERVER_HOST);
  assert.deepEqual(await reviews.start(ref), { threadId: "thr_new" });
  assert.deepEqual(calls, ["snapshot diff", "fetch into /repos/bb-plugins", `spawn on ${SERVER_HOST}`, "save run"]);
});

test("Start refuses a PR that already has a guide for its current commit, before anything runs", async () => {
  const { reviews, calls } = startHarness(SERVER_HOST, { kind: "ready", threadId: "thr_1", guideHeadSha: "head1" });
  await assert.rejects(reviews.start(ref), { code: "conflict", message: "This PR already has a guide for its current commit." });
  assert.deepEqual(calls, []);
});
