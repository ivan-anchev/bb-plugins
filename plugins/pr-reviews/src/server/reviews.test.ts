import assert from "node:assert/strict";
import { test } from "node:test";
import { repoSchema } from "../github/repo.ts";
import { deriveRunningReview, type ThreadFacts } from "./review-state.ts";
import { createReviews, type PrRef } from "./reviews.ts";
import type { ReviewRun } from "./store.ts";
import type { GuideRecord, PrDetail, ReviewState } from "../contract.ts";
import { hunkIdSchema } from "../diff/diff-schema.ts";
import type { Finding } from "../guide/guide-schema.ts";
import { askMessage } from "./prompt.ts";

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
      guide: () => assert.fail("Cancel must not read a guide"),
    },
    settings: { get: notUsedByCancel },
    reader: {
      pullRequest: async () => assert.fail("gh: could not reach api.github.com"),
      runningReview: async () => deriveRunningReview({ guides: [], runs, threads }),
      threadIsOpen: notUsedByCancel,
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
  headSha: "head2",
  body: "",
  url: "https://github.com/ivan-anchev/bb-plugins/pull/23",
  headRefName: "fixture/pr-reviews-live",
  baseRefName: "main",
  state: "OPEN",
  commits: ["head1", "head2"],
};
const DIFF = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";

// Start or Update with the PR in `review`, the project's default checkout on `checkoutHost`, the
// threads in `openThreads` still open, and every GitHub read, fetch, spawn, message and saved run
// recorded in order.
function actionHarness(checkoutHost: string, review: ReviewState = { kind: "none" }, openThreads: string[] = []) {
  const calls: string[] = [];
  const messages: string[] = [];
  let pullRequestReads = 0;
  const reviews = createReviews({
    bb: {
      rpc: { experimental_invalidate: () => undefined },
      sdk: {
        threads: {
          spawn: async ({ environment }) => {
            calls.push(`spawn on ${environment.type === "host" ? environment.hostId : environment.type}`);
            return { id: "thr_new" };
          },
          send: async ({ threadId, input, mode }) => {
            calls.push(`send to ${threadId} (${mode})`);
            messages.push(...input.flatMap((part) => (part.type === "text" ? [part.text] : [])));
            return { ok: true, delivery: "sent" };
          },
          stop: async () => assert.fail("Start and Update must not stop a thread"),
        },
        projects: { get: async () => ({ sources: [{ path: "/repos/bb-plugins", hostId: checkoutHost, isDefault: true }] }) },
        system: { config: async () => ({ primaryHostId: SERVER_HOST }) },
      },
    },
    store: {
      saveRun: (run) => void calls.push(`save run for ${run.key.headSha} by ${run.threadId}`),
      deleteRun: () => assert.fail("Start and Update must not delete a run"),
      guide: () => assert.fail("Start and Update must not read a guide"),
    },
    settings: { get: async () => ({ instructions: "" }) },
    reader: {
      pullRequest: async () => {
        pullRequestReads += 1;
        return { pr: PR, review };
      },
      runningReview: async () => assert.fail("Start and Update read the review through pullRequest"),
      threadIsOpen: async (threadId) => openThreads.includes(threadId),
    },
    github: {
      snapshotPrDiff: async () => {
        calls.push("snapshot diff");
        return { headSha: PR.headSha, baseSha: "base1", diff: DIFF };
      },
      fetchPrCommits: async (path, _number, { headSha, baseSha }) => void calls.push(`fetch ${headSha} and ${baseSha} into ${path}`),
    },
  });
  return { reviews, calls, messages, pullRequestReads: () => pullRequestReads };
}

test("Start refuses a default checkout on another machine before reading the diff, fetching, or spawning", async () => {
  const { reviews, calls } = actionHarness("host_remote");
  await assert.rejects(reviews.start(ref), /default checkout is on the machine running bb/);
  assert.deepEqual(calls, []);
});

test("Start on the server's own machine fetches the PR's commits, then spawns there", async () => {
  const { reviews, calls } = actionHarness(SERVER_HOST);
  assert.deepEqual(await reviews.start(ref), { threadId: "thr_new" });
  assert.deepEqual(calls, ["snapshot diff", "fetch head2 and base1 into /repos/bb-plugins", `spawn on ${SERVER_HOST}`, "save run for head2 by thr_new"]);
});

test("Start refuses a PR that already has a guide for its current commit, before anything runs", async () => {
  const { reviews, calls } = actionHarness(SERVER_HOST, { kind: "ready", threadId: "thr_1", guideHeadSha: "head2" });
  await assert.rejects(reviews.start(ref), { code: "conflict", message: "This PR already has a guide for its current commit." });
  assert.deepEqual(calls, []);
});

// ---- updating a stale guide ----

const STALE: ReviewState = { kind: "stale", threadId: "thr_old", guideHeadSha: "head1" };

test("Update pins the new head's diff, fetches its commits, then messages the guide's own thread and saves its run for the new head", async () => {
  const { reviews, calls, messages } = actionHarness(SERVER_HOST, STALE, ["thr_old"]);
  assert.deepEqual(await reviews.update(ref), { threadId: "thr_old" });
  assert.deepEqual(calls, ["snapshot diff", "fetch head2 and base1 into /repos/bb-plugins", "send to thr_old (queue-if-active)", "save run for head2 by thr_old"]);
  assert.match(messages[0] ?? "", /git diff head1\.\.head2/);
});

test("Update starts a new review when the guide's thread was archived or deleted", async () => {
  const { reviews, calls, messages } = actionHarness(SERVER_HOST, STALE, []);
  assert.deepEqual(await reviews.update(ref), { threadId: "thr_new" });
  assert.deepEqual(calls, ["snapshot diff", "fetch head2 and base1 into /repos/bb-plugins", `spawn on ${SERVER_HOST}`, "save run for head2 by thr_new"]);
  assert.deepEqual(messages, []);
});

test("Update refuses a default checkout on another machine before reading the diff, fetching, or messaging", async () => {
  const { reviews, calls } = actionHarness("host_remote", STALE, ["thr_old"]);
  await assert.rejects(reviews.update(ref), /default checkout is on the machine running bb/);
  assert.deepEqual(calls, []);
});

test("Update joins a review already running, and refuses a PR without a stale guide", async () => {
  const running = actionHarness(SERVER_HOST, { kind: "running", threadId: "thr_old", runHeadSha: "head2", startedAt: 1 });
  assert.deepEqual(await running.reviews.update(ref), { threadId: "thr_old" });
  assert.deepEqual(running.calls, []);
  for (const review of [{ kind: "none" }, { kind: "ready", threadId: "thr_old", guideHeadSha: "head2" }, { kind: "no-guide", threadId: "thr_old", idleSince: 1 }] as const) {
    const { reviews, calls } = actionHarness(SERVER_HOST, review, ["thr_old"]);
    await assert.rejects(reviews.update(ref), { code: "conflict" });
    assert.deepEqual(calls, []);
  }
});

test("a second Update while the first is in flight joins it: one message, one run", async () => {
  const { reviews, calls, pullRequestReads } = actionHarness(SERVER_HOST, STALE, ["thr_old"]);
  const [first, second] = await Promise.all([reviews.update(ref), reviews.update(ref)]);
  assert.deepEqual([first, second], [{ threadId: "thr_old" }, { threadId: "thr_old" }]);
  assert.equal(pullRequestReads(), 1);
  assert.equal(calls.filter((call) => call.startsWith("send")).length, 1);
});

// ---- asking about a finding ----

const FINDING: Finding = {
  file: "src/a.ts",
  line: 2,
  side: "old",
  hunk: hunkIdSchema.parse("@@ -1,2 +1,1 @@"),
  priority: "p0",
  title: "Drops the last token",
  body: "…",
};
const GUIDE_KEY = { repo, number: 23, headSha: "head1" };
const RECORD: GuideRecord = {
  key: GUIDE_KEY,
  threadId: "thr_review",
  model: null,
  submittedAt: 100,
  guide: { overview: { problem: "…", approach: "…", behaviour: null }, steps: [], hidden: [], findings: [FINDING] },
};

const notUsedByAsk = async () => assert.fail("Ask must not call this");

// Ask with one stored guide, recording every message bb is asked to send.
function askHarness() {
  const sent: unknown[] = [];
  const reviews = createReviews({
    bb: {
      rpc: { experimental_invalidate: () => assert.fail("Ask changes no read") },
      sdk: {
        threads: {
          spawn: notUsedByAsk,
          stop: notUsedByAsk,
          send: async (args) => {
            sent.push(args);
            return { ok: true, delivery: "sent" };
          },
        },
        projects: { get: notUsedByAsk },
        system: { config: notUsedByAsk },
      },
    },
    store: {
      saveRun: () => assert.fail("Ask must not save a run"),
      deleteRun: () => assert.fail("Ask must not delete a run"),
      guide: (key) => (key.headSha === GUIDE_KEY.headSha ? RECORD : null),
    },
    settings: { get: notUsedByAsk },
    reader: { pullRequest: notUsedByAsk, runningReview: notUsedByAsk, threadIsOpen: notUsedByAsk },
    github: { snapshotPrDiff: notUsedByAsk, fetchPrCommits: notUsedByAsk },
  });
  return { reviews, sent };
}

test("Ask sends the question about the finding to the guide's thread, queued behind any running turn", async () => {
  const { reviews, sent } = askHarness();
  await reviews.ask(GUIDE_KEY, 0, "Is the last token ever empty?");
  assert.deepEqual(sent, [
    { threadId: "thr_review", input: [{ type: "text", text: askMessage(FINDING, "Is the last token ever empty?"), mentions: [] }], mode: "queue-if-active" },
  ]);
});

test("Ask refuses a finding the guide does not have, or a head with no guide, and sends nothing", async () => {
  const { reviews, sent } = askHarness();
  await assert.rejects(reviews.ask(GUIDE_KEY, 1, "Why?"), { code: "not_found" });
  await assert.rejects(reviews.ask({ ...GUIDE_KEY, headSha: "head2" }, 0, "Why?"), { code: "not_found" });
  assert.deepEqual(sent, []);
});
