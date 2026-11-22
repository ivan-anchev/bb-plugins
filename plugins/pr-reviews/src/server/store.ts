import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { GuideRecord, PrHeadKey, Visit } from "../contract.ts";
import type { DiffFile } from "../diff/diff-schema.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import { guideSchema } from "../guide/guide-schema.ts";
import { repoSchema, type Repo } from "../github/repo.ts";

/** "Thread `threadId` was asked, at `requestedAt` (epoch ms), to write the guide for `key`." */
export type ReviewRun = { key: PrHeadKey; threadId: string; requestedAt: number };

/** A guide without its body: what review state needs for every row of the list. */
export type GuideHead = Pick<GuideRecord, "key" | "threadId" | "submittedAt">;

const MIGRATIONS = [
  `CREATE TABLE diff_snapshots (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     diff TEXT NOT NULL, taken_at INTEGER NOT NULL, PRIMARY KEY (repo, number, head_sha))`,
  `CREATE TABLE review_runs (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     thread_id TEXT NOT NULL, requested_at INTEGER NOT NULL, PRIMARY KEY (repo, number, head_sha))`,
  `CREATE INDEX review_runs_by_thread ON review_runs (thread_id, requested_at)`,
  `CREATE TABLE guides (repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
     thread_id TEXT NOT NULL, model TEXT, submitted_at INTEGER NOT NULL, guide TEXT NOT NULL,
     PRIMARY KEY (repo, number, head_sha))`,
  `CREATE TABLE visits (repo TEXT NOT NULL COLLATE NOCASE, number INTEGER NOT NULL, project_id TEXT NOT NULL,
     opened_at INTEGER NOT NULL, PRIMARY KEY (repo, number))`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
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

    runForThread(threadId: string): ReviewRun | null {
      const row = db().prepare("SELECT * FROM review_runs WHERE thread_id = ?").get(threadId);
      return row === undefined ? null : toRun(row);
    },

    runsFor(repo: Repo, numbers: number[]): ReviewRun[] {
      return db()
        .prepare("SELECT * FROM review_runs WHERE repo = ? AND number IN (SELECT value FROM json_each(?))")
        .all(repo, JSON.stringify(numbers))
        .map(toRun);
    },

    snapshotFiles({ repo, number, headSha }: PrHeadKey): DiffFile[] {
      const row = db().prepare("SELECT diff FROM diff_snapshots WHERE repo = ? AND number = ? AND head_sha = ?").get(repo, number, headSha);
      return parsePrDiff(snapshotRowSchema.parse(row).diff);
    },

    saveGuide({ key, threadId, model, submittedAt, guide }: GuideRecord): void {
      db()
        .prepare("INSERT OR REPLACE INTO guides VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(key.repo, key.number, key.headSha, threadId, model, submittedAt, JSON.stringify(guide));
    },

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

    saveVisit({ projectId, repo, number, openedAt }: Visit): void {
      db()
        .prepare(
          `INSERT INTO visits VALUES (?, ?, ?, ?) ON CONFLICT (repo, number) DO UPDATE
             SET project_id = excluded.project_id, opened_at = excluded.opened_at WHERE excluded.opened_at > visits.opened_at`,
        )
        .run(repo, number, projectId, openedAt);
    },

    visits(): Visit[] {
      return db().prepare("SELECT * FROM visits").all().map(toVisit);
    },
  };
}

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

const visitRowSchema = z.object({ repo: repoSchema, number: z.number(), project_id: z.string(), opened_at: z.number() });

function toVisit(row: unknown): Visit {
  const { repo, number, project_id, opened_at } = visitRowSchema.parse(row);
  return { projectId: project_id, repo, number, openedAt: opened_at };
}
