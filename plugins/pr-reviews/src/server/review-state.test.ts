import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewState } from "../contract.ts";
import { repoSchema } from "../github/repo.ts";
import { deriveReviewState, type ReviewFacts, type ThreadFacts } from "./review-state.ts";
import type { ReviewRun } from "./store.ts";

const HEAD = "head2";
const repo = repoSchema.parse("ivan-anchev/bb-plugins");
const run = (threadId: string, headSha: string, requestedAt: number): ReviewRun => ({ key: { repo, number: 23, headSha }, threadId, requestedAt });
const thread = (status: ThreadFacts["status"], updatedAt = 900): ThreadFacts => ({ status, updatedAt });
const threads = (entries: Record<string, ThreadFacts>) => new Map(Object.entries(entries));

const cases: [name: string, facts: Omit<ReviewFacts, "headSha">, state: ReviewState][] = [
  ["no runs", { runs: [], threads: threads({}) }, { kind: "none" }],
  ...(["starting", "pending", "active", "stopping"] as const).map((status): (typeof cases)[number] => [
    `a ${status} thread for the current head`,
    { runs: [run("t1", HEAD, 100)], threads: threads({ t1: thread(status) }) },
    { kind: "running", threadId: "t1", runHeadSha: HEAD, startedAt: 100 },
  ]),
  [
    "an idle thread for the current head",
    { runs: [run("t1", HEAD, 100)], threads: threads({ t1: thread("idle", 900) }) },
    { kind: "no-guide", threadId: "t1", idleSince: 900 },
  ],
  [
    "a failed thread for the current head",
    { runs: [run("t1", HEAD, 100)], threads: threads({ t1: thread("error", 950) }) },
    { kind: "no-guide", threadId: "t1", idleSince: 950 },
  ],
  [
    "the run's thread was archived or deleted",
    { runs: [run("t1", HEAD, 100)], threads: threads({}) },
    { kind: "none" },
  ],
  [
    "an idle thread for an older head",
    { runs: [run("t1", "head1", 100)], threads: threads({ t1: thread("idle") }) },
    { kind: "none" },
  ],
  [
    "a busy thread still writing for an older head",
    { runs: [run("t1", "head1", 100)], threads: threads({ t1: thread("active") }) },
    { kind: "running", threadId: "t1", runHeadSha: "head1", startedAt: 100 },
  ],
  [
    "the newest run decides: busy beats an older settled run",
    { runs: [run("t1", "head1", 100), run("t2", HEAD, 200)], threads: threads({ t1: thread("idle"), t2: thread("active") }) },
    { kind: "running", threadId: "t2", runHeadSha: HEAD, startedAt: 200 },
  ],
  [
    "the newest run decides: an old thread answering a question is not running",
    { runs: [run("t1", "head1", 100), run("t2", HEAD, 200)], threads: threads({ t1: thread("active"), t2: thread("idle", 990) }) },
    { kind: "no-guide", threadId: "t2", idleSince: 990 },
  ],
];

for (const [name, facts, state] of cases) {
  test(`${name} reads as ${state.kind}`, () => {
    assert.deepEqual(deriveReviewState({ headSha: HEAD, ...facts }), state);
  });
}
