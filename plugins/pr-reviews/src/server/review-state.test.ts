import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewState } from "../contract.ts";
import { repoSchema } from "../github/repo.ts";
import { deriveReviewState, type ReviewFacts, type ThreadFacts } from "./review-state.ts";
import type { GuideHead, ReviewRun } from "./store.ts";

const HEAD = "head2";
const repo = repoSchema.parse("ivan-anchev/bb-plugins");
const run = (threadId: string, headSha: string, requestedAt: number): ReviewRun => ({ key: { repo, number: 23, headSha }, threadId, requestedAt });
const guide = (threadId: string, headSha: string, submittedAt: number): GuideHead => ({ key: { repo, number: 23, headSha }, threadId, submittedAt });
const thread = (status: ThreadFacts["status"], updatedAt = 900): ThreadFacts => ({ status, updatedAt });
const threads = (entries: Record<string, ThreadFacts>) => new Map(Object.entries(entries));

type Facts = Omit<ReviewFacts, "headSha" | "guides"> & Partial<Pick<ReviewFacts, "guides">>;

const cases: [name: string, facts: Facts, state: ReviewState][] = [
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
  [
    "a guide for the current head",
    { guides: [guide("t1", HEAD, 300)], runs: [run("t1", HEAD, 100)], threads: threads({ t1: thread("idle") }) },
    { kind: "ready", threadId: "t1", guideHeadSha: HEAD },
  ],
  [
    "a guide for the current head wins over a busy thread",
    { guides: [guide("t1", HEAD, 300)], runs: [run("t1", HEAD, 100)], threads: threads({ t1: thread("active") }) },
    { kind: "ready", threadId: "t1", guideHeadSha: HEAD },
  ],
  [
    "a guide for the current head whose thread was archived",
    { guides: [guide("t1", HEAD, 300)], runs: [run("t1", HEAD, 100)], threads: threads({}) },
    { kind: "ready", threadId: "t1", guideHeadSha: HEAD },
  ],
  [
    "a guide for an older head only",
    { guides: [guide("t1", "head1", 300)], runs: [run("t1", "head1", 100)], threads: threads({ t1: thread("idle") }) },
    { kind: "stale", threadId: "t1", guideHeadSha: "head1" },
  ],
  [
    "the newest of two older guides",
    { guides: [guide("t2", "head1b", 500), guide("t1", "head1", 300)], runs: [], threads: threads({}) },
    { kind: "stale", threadId: "t2", guideHeadSha: "head1b" },
  ],
  [
    "an older head's thread answering a question about its guide is not running",
    { guides: [guide("t1", "head1", 300)], runs: [run("t1", "head1", 100)], threads: threads({ t1: thread("active") }) },
    { kind: "stale", threadId: "t1", guideHeadSha: "head1" },
  ],
  [
    "a busy run for the current head beats an older guide",
    { guides: [guide("t1", "head1", 300)], runs: [run("t1", "head1", 100), run("t2", HEAD, 400)], threads: threads({ t1: thread("idle"), t2: thread("active") }) },
    { kind: "running", threadId: "t2", runHeadSha: HEAD, startedAt: 400 },
  ],
  [
    "a settled run for the current head beats an older guide",
    { guides: [guide("t1", "head1", 300)], runs: [run("t1", "head1", 100), run("t2", HEAD, 400)], threads: threads({ t1: thread("idle"), t2: thread("idle", 990) }) },
    { kind: "no-guide", threadId: "t2", idleSince: 990 },
  ],
];

for (const [name, { guides = [], ...facts }, state] of cases) {
  test(`${name} reads as ${state.kind}`, () => {
    assert.deepEqual(deriveReviewState({ headSha: HEAD, guides, ...facts }), state);
  });
}
