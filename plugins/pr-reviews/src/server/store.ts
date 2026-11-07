// The plugin's SQLite: the diff pinned for each reviewed head, and the review runs. Every SQL
// statement lives here.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { repoSchema, type Repo } from "../github/repo.ts";

/** One head commit of one PR: the key of a pinned diff and of a review run. */
export type PrHeadKey = { repo: Repo; number: number; headSha: string };

/** "Thread `threadId` was asked, at `requestedAt` (epoch ms), to write the guide for `key`." */
export type ReviewRun = { key: PrHeadKey; threadId: string; requestedAt: number };

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [
  `CREATE TABLE diff_snapshots (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     diff TEXT NOT NULL, taken_at INTEGER NOT NULL, PRIMARY KEY (repo, number, head_sha))`,
  `CREATE TABLE review_runs (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     thread_id TEXT NOT NULL, requested_at INTEGER NOT NULL, PRIMARY KEY (repo, number, head_sha))`,
  `CREATE INDEX review_runs_by_thread ON review_runs (thread_id, requested_at)`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: PluginStorage) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    // The run and the diff its prompt was built from land together or not at all. REPLACE on
    // both: a new run for the same head (after Cancel) takes over the key, and the base branch
    // may have moved since, which changes the diff without changing the head.
    saveRun(run: ReviewRun, diff: string): void {
      const { repo, number, headSha } = run.key;
      db().transaction(() => {
        db().prepare("INSERT OR REPLACE INTO diff_snapshots VALUES (?, ?, ?, ?, ?)").run(repo, number, headSha, diff, run.requestedAt);
        db().prepare("INSERT OR REPLACE INTO review_runs VALUES (?, ?, ?, ?, ?)").run(repo, number, headSha, run.threadId, run.requestedAt);
      })();
    },

    deleteRun({ repo, number, headSha }: PrHeadKey): void {
      db().prepare("DELETE FROM review_runs WHERE repo = ? AND number = ? AND head_sha = ?").run(repo, number, headSha);
    },

    /** The head this thread is writing a guide for now: its newest run. */
    latestRunForThread(threadId: string): ReviewRun | null {
      const row = db().prepare("SELECT * FROM review_runs WHERE thread_id = ? ORDER BY requested_at DESC LIMIT 1").get(threadId);
      return row === undefined ? null : toRun(row);
    },

    /** Every run of these PRs, for any head. */
    runsFor(repo: Repo, numbers: number[]): ReviewRun[] {
      return db()
        .prepare("SELECT * FROM review_runs WHERE repo = ? AND number IN (SELECT value FROM json_each(?))")
        .all(repo, JSON.stringify(numbers))
        .map(toRun);
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
