// Pull requests, by branch: as the PR watch last read each one, and why its latest read failed.
// why by branch: the pull request belongs to the branch, so every agent that works on it shares
// one snapshot, one CI history and one "opened".
import { z } from "zod";
import type { AgentId } from "../../../model/agent/agent.ts";
import { handoffIdSchema, type HandoffId } from "../../../model/agent/handoff.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { meaningfulChanges, prSnapshotSchema, prUnavailableSchema, type PrSnapshot, type PrStatus, type PrUnavailable } from "../../../model/verdict/pr.ts";
import { insertEvent } from "../inbox/inbox-store.ts";
import { json, nullableJson, type Db } from "../rows.ts";

/** A branch's PR status, and when the watch last tried to read it. */
type PolledPr = PrStatus & { polledAt: number };

export function prStore(db: Db) {
  function prOfBranch(coordinatorId: CoordinatorId, branch: string): PolledPr | null {
    const row = db()
      .prepare(
        `SELECT snapshot, head_seen_at AS headSeenAt, read_at AS readAt, handoff_at_read AS handoffAtRead, unavailable, polled_at AS polledAt
           FROM pr_snapshots WHERE coordinator_id = ? AND branch = ?`,
      )
      .get(coordinatorId, branch);
    return row === undefined ? null : prStatusRowSchema.parse(row);
  }

  /** Records that a read of the branch's pull request was tried, and why it failed (null: it didn't). */
  function markPolled(coordinatorId: CoordinatorId, branch: string, unavailable: PrUnavailable | null, at: number): void {
    db()
      .prepare(
        `INSERT INTO pr_snapshots (coordinator_id, branch, unavailable, polled_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (coordinator_id, branch) DO UPDATE SET unavailable = excluded.unavailable, polled_at = excluded.polled_at`,
      )
      .run(coordinatorId, branch, unavailable === null ? null : JSON.stringify(unavailable), at);
  }

  return {
    /** What the watch knows of the branch's pull request, or null before it first tried to read it. */
    prOfBranch,

    /**
     * Saves a successful read of the branch's pull request, begun when the latest handoff on it was
     * `handoffAtRead`. One that found it saves its snapshot as read now, with when a read first saw
     * its head commit and that handoff, and records a `pr` event naming `on`, the issue and the agent
     * on the branch, when it changed meaningfully, together. One that found none (null) keeps the
     * snapshot already saved as it was read, and vouches for nothing about it.
     */
    savePrRead(coordinatorId: CoordinatorId, branch: string, on: { issueId: IssueId; agentId: AgentId }, pr: PrSnapshot | null, handoffAtRead: HandoffId | null, at: number): void {
      db().transaction(() => {
        const before = prOfBranch(coordinatorId, branch);
        markPolled(coordinatorId, branch, null, at);
        if (pr === null) return;
        const headSeenAt = before !== null && before.snapshot !== null && before.snapshot.headSha === pr.headSha ? before.headSeenAt : at;
        db()
          .prepare("UPDATE pr_snapshots SET snapshot = ?, head_seen_at = ?, read_at = ?, handoff_at_read = ? WHERE coordinator_id = ? AND branch = ?")
          .run(JSON.stringify(pr), headSeenAt, at, handoffAtRead, coordinatorId, branch);
        const changes = meaningfulChanges(before?.snapshot ?? null, pr);
        if (changes.length > 0) insertEvent(db, coordinatorId, { kind: "pr", ...on, pr, changes }, at);
      })();
    },

    /** Records why reading the branch's pull request failed, and whether that lasts. The snapshot it had stays as it was read, and nothing is recorded for its regional manager. */
    markPrUnavailable(coordinatorId: CoordinatorId, branch: string, unavailable: PrUnavailable, at: number): void {
      markPolled(coordinatorId, branch, unavailable, at);
    },
  };
}

const polledSchema = z.object({ unavailable: nullableJson(prUnavailableSchema), polledAt: z.number() });
const prStatusRowSchema = z.union([
  polledSchema.extend({ snapshot: z.null() }),
  polledSchema.extend({ snapshot: json(prSnapshotSchema), headSeenAt: z.number(), readAt: z.number(), handoffAtRead: handoffIdSchema.nullable() }),
]);
