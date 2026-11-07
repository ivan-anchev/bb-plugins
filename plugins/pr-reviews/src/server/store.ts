// The plugin's SQLite: the diff pinned for each reviewed head, the review runs, and the
// guides. Every SQL statement lives here.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { GuideRecord, PrHeadKey } from "../contract.ts";
import type { DiffFile } from "../diff/diff-schema.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import { guideSchema } from "../guide/guide-schema.ts";
import { repoSchema, type Repo } from "../github/repo.ts";

/** "Thread `threadId` was asked, at `requestedAt` (epoch ms), to write the guide for `key`." */
export type ReviewRun = { key: PrHeadKey; threadId: string; requestedAt: number };

/** A guide without its body: what review state needs for every row of the list. */
export type GuideHead = Pick<GuideRecord, "key" | "threadId" | "submittedAt">;

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [
  `CREATE TABLE diff_snapshots (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     diff TEXT NOT NULL, taken_at INTEGER NOT NULL, PRIMARY KEY (repo, number, head_sha))`,
  `CREATE TABLE review_runs (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     thread_id TEXT NOT NULL, requested_at INTEGER NOT NULL, PRIMARY KEY (repo, number, head_sha))`,
  `CREATE INDEX review_runs_by_thread ON review_runs (thread_id, requested_at)`,
  `CREATE TABLE guides (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     thread_id TEXT NOT NULL, model TEXT, submitted_at INTEGER NOT NULL, guide TEXT NOT NULL,
     PRIMARY KEY (repo, number, head_sha))`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    // The run and the diff its prompt was built from land together or not at all. A PR has one
    // run, the review it waits for now: a new run replaces the PR's earlier ones, for any head and
    // any thread, so no submission can land on a head the PR has moved past. REPLACE on the diff:
    // the base branch may have moved since, which changes the diff without changing the head.
    saveRun(run: ReviewRun, diff: string): void {
      const { repo, number, headSha } = run.key;
      db().transaction(() => {
        db().prepare("INSERT OR REPLACE INTO diff_snapshots VALUES (?, ?, ?, ?, ?)").run(repo, number, headSha, diff, run.requestedAt);
        db().prepare("DELETE FROM review_runs WHERE repo = ? AND number = ?").run(repo, number);
        db().prepare("INSERT INTO review_runs VALUES (?, ?, ?, ?, ?)").run(repo, number, headSha, run.threadId, run.requestedAt);
      })();
    },

    deleteRun({ repo, number, headSha }: PrHeadKey): void {
      db().prepare("DELETE FROM review_runs WHERE repo = ? AND number = ? AND head_sha = ?").run(repo, number, headSha);
    },

    /** The head this thread is writing a guide for now, or null once its review was cancelled or replaced. */
    runForThread(threadId: string): ReviewRun | null {
      const row = db().prepare("SELECT * FROM review_runs WHERE thread_id = ?").get(threadId);
      return row === undefined ? null : toRun(row);
    },

    /** The runs of these PRs: at most one each. */
    runsFor(repo: Repo, numbers: number[]): ReviewRun[] {
      return db()
        .prepare("SELECT * FROM review_runs WHERE repo = ? AND number IN (SELECT value FROM json_each(?))")
        .all(repo, JSON.stringify(numbers))
        .map(toRun);
    },

    /** The diff the run for `key` was prompted with, parsed. Every run saved one. */
    snapshotFiles({ repo, number, headSha }: PrHeadKey): DiffFile[] {
      const row = db().prepare("SELECT diff FROM diff_snapshots WHERE repo = ? AND number = ? AND head_sha = ?").get(repo, number, headSha);
      return parsePrDiff(snapshotRowSchema.parse(row).diff);
    },

    // REPLACE: a second submission for the same head replaces the first.
    saveGuide({ key, threadId, model, submittedAt, guide }: GuideRecord): void {
      db()
        .prepare("INSERT OR REPLACE INTO guides VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(key.repo, key.number, key.headSha, threadId, model, submittedAt, JSON.stringify(guide));
    },

    /** Every guide of these PRs, for any head, without the guide itself. */
    guideHeadsFor(repo: Repo, numbers: number[]): GuideHead[] {
      return db()
        .prepare("SELECT repo, number, head_sha, thread_id, submitted_at FROM guides WHERE repo = ? AND number IN (SELECT value FROM json_each(?))")
        .all(repo, JSON.stringify(numbers))
        .map(toGuideHead);
    },

    guide({ repo, number, headSha }: PrHeadKey): GuideRecord | null {
      const row = db().prepare("SELECT * FROM guides WHERE repo = ? AND number = ? AND head_sha = ?").get(repo, number, headSha);
      return row === undefined ? null : toGuideRecord(row);
    },
  };
}

// Database rows are a boundary: parse them into the canonical type.
const runRowSchema = z.object({
  repo: repoSchema,
  number: z.number(),
  head_sha: z.string(),
  thread_id: z.string(),
  requested_at: z.number(),
});

function toRun(row: unknown): ReviewRun {
  const { repo, number, head_sha, thread_id, requested_at } = runRowSchema.parse(row);
  return { key: { repo, number, headSha: head_sha }, threadId: thread_id, requestedAt: requested_at };
}

const snapshotRowSchema = z.object({ diff: z.string() });

const guideHeadRowSchema = z.object({
  repo: repoSchema,
  number: z.number(),
  head_sha: z.string(),
  thread_id: z.string(),
  submitted_at: z.number(),
});

const guideRowSchema = guideHeadRowSchema.extend({ model: z.string().nullable(), guide: z.string() });

const toGuideHead = (row: unknown): GuideHead => headOf(guideHeadRowSchema.parse(row));

function toGuideRecord(row: unknown): GuideRecord {
  const parsed = guideRowSchema.parse(row);
  return { ...headOf(parsed), model: parsed.model, guide: guideSchema.parse(JSON.parse(parsed.guide)) };
}

function headOf({ repo, number, head_sha, thread_id, submitted_at }: z.infer<typeof guideHeadRowSchema>): GuideHead {
  return { key: { repo, number, headSha: head_sha }, threadId: thread_id, submittedAt: submitted_at };
}
