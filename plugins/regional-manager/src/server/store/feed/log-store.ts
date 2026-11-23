// Issues' logs (migrations.ts issue_log): appended to, never rewritten. Its writers are the plan's
// one writer (issues-store.ts updateIssue, through appendLog in its own transaction) and the status
// watch (observeStatuses). Rows are parsed into Logged here and nowhere else, one at a time: a row
// this version can't read (a kind or status a newer one logged, or text it can't decode) is left
// out, never failing the rest.
import { z } from "zod";
import { logEventSchema, statusMoves, type LogEvent, type Logged } from "../../../model/feed/log-event.ts";
import { issueIdSchema, type IssueId } from "../../../model/issue/issue.ts";
import { issueStatusSchema, type IssueStatus, type IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Db } from "../rows.ts";

/** Appends `events` to the issue's log, in order, at `at`. Call inside the transaction of the write they tell. */
export function appendLog(db: Db, coordinatorId: CoordinatorId, issueId: IssueId, at: number, events: readonly LogEvent[]): void {
  const insert = db().prepare("INSERT INTO issue_log (coordinator_id, issue_id, at, event) VALUES (?, ?, ?, ?)");
  for (const event of events) insert.run(coordinatorId, issueId, at, JSON.stringify(event));
}

export function logStore(db: Db) {
  return {
    /** The issue's log, in the order written. */
    logOf(coordinatorId: CoordinatorId, issueId: IssueId): Logged[] {
      return db()
        .prepare("SELECT at, event FROM issue_log WHERE coordinator_id = ? AND issue_id = ? ORDER BY seq")
        .all(coordinatorId, issueId)
        .flatMap((row) => {
          const { at, event } = logRowSchema.parse(row);
          const logged = eventOf(event);
          return logged === null ? [] : [{ at, event: logged }];
        });
    },

    /**
     * Logs, at `at`, the status of each issue in `views` (every issue of the regional manager, read
     * whole and current) that isn't the last one logged for it, and returns how many it logged.
     * Idempotent: the same views a second time log nothing. Call with views no change overtook
     * (current-views.ts whileCurrent), in the same act, so a status is logged only as it was.
     */
    observeStatuses(coordinatorId: CoordinatorId, views: readonly Pick<IssueView, "issue" | "status">[], at: number): number {
      return db().transaction(() => {
        const moves = statusMoves(lastStatuses(db, coordinatorId), views);
        for (const { issueId, status } of moves) appendLog(db, coordinatorId, issueId, at, [{ kind: "status", status }]);
        return moves.length;
      })();
    },
  };
}

/**
 * The last status logged for each of the regional manager's issues; an issue with none logged is
 * absent, and so is one whose last is a status this version doesn't know, so the status it sees is
 * logged after it. why max(seq) with its row: SQLite gives a bare column the row the max came from.
 */
function lastStatuses(db: Db, coordinatorId: CoordinatorId): Map<IssueId, IssueStatus> {
  const rows = db()
    .prepare("SELECT issue_id AS issueId, json_extract(event, '$.status') AS status, max(seq) FROM issue_log WHERE coordinator_id = ? AND json_extract(event, '$.kind') = 'status' GROUP BY issue_id")
    .all(coordinatorId);
  return new Map(rows.flatMap((row) => lastStatusRowSchema.safeParse(row).data ?? []).map(({ issueId, status }) => [issueId, status]));
}

/** The event `text` holds, or null when this version can't read it: a kind or status it doesn't know, or text JSON.parse can't decode (SQLite stores JSON5, as a trailing comma, that it can't). */
function eventOf(text: string): LogEvent | null {
  try {
    return logEventSchema.safeParse(JSON.parse(text)).data ?? null;
  } catch {
    // why here: an undecodable row is left out at this boundary, as an unknown one is, never failing the rest.
    return null;
  }
}

const logRowSchema = z.object({ at: z.number().int(), event: z.string() });
const lastStatusRowSchema = z.object({ issueId: issueIdSchema, status: issueStatusSchema });
