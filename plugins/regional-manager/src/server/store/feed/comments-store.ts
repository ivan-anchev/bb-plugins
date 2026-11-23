// Comments on issues (migrations.ts comments): appended, never edited. Each is stored with what the
// regional manager is told of it, in one transaction: the user's wakes it, an agent's waits for its
// next catch-up, and its own tells it nothing.
import { z } from "zod";
import { commentAuthorSchema, commentIdSchema, commentSchema, type Comment, type CommentAuthor, type CommentId } from "../../../model/feed/comment.ts";
import type { InboxEvent } from "../../../model/inbox/inbox-event.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { insertEvent } from "../inbox/inbox-store.ts";
import { json, type Db } from "../rows.ts";

/** A comment to post: its id and time are the store's. */
export type NewComment = Pick<Comment, "issueId" | "author" | "text" | "replyTo">;

export function commentsStore(db: Db) {
  return {
    /**
     * Stores the comment and what the regional manager is told of it (announcementOf), together, at
     * `at`, and returns its id; null, with nothing written, when `replyTo` names no comment of the
     * same issue. The issue is one of the regional manager's: its caller checked.
     */
    commentIssue(coordinatorId: CoordinatorId, { issueId, author, text, replyTo }: NewComment, at: number): CommentId | null {
      return db().transaction(() => {
        if (replyTo !== null && db().prepare("SELECT 1 FROM comments WHERE id = ? AND coordinator_id = ? AND issue_id = ?").get(rowIdOf(replyTo), coordinatorId, issueId) === undefined) return null;
        const row = db()
          .prepare("INSERT INTO comments (coordinator_id, issue_id, author, text, reply_to, at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
          .get(coordinatorId, issueId, JSON.stringify(author), text, replyTo === null ? null : rowIdOf(replyTo), at);
        const commentId = z.object({ id: idOfRowSchema }).parse(row).id;
        const event = announcementOf(author, issueId, commentId);
        if (event !== null) insertEvent(db, coordinatorId, event, at);
        return commentId;
      })();
    },

    /** The issue's comments, in the order posted. */
    commentsOf(coordinatorId: CoordinatorId, issueId: IssueId): Comment[] {
      return db().prepare(`SELECT ${COLUMNS} FROM comments WHERE coordinator_id = ? AND issue_id = ? ORDER BY id`).all(coordinatorId, issueId).map(toComment);
    },

    /** A comment by its id; null when there is none. */
    comment(id: CommentId): Comment | null {
      const row = db().prepare(`SELECT ${COLUMNS} FROM comments WHERE id = ?`).get(rowIdOf(id));
      return row === undefined ? null : toComment(row);
    },
  };
}

/** What the regional manager is told of a comment: the user's wakes it; an agent's waits for its next catch-up; its own, nothing. */
function announcementOf(author: CommentAuthor, issueId: IssueId, commentId: CommentId): InboxEvent | null {
  switch (author.kind) {
    case "user":
      return { kind: "comment-to-you", issueId, commentId };
    case "agent":
      return { kind: "comment", issueId, agentId: author.agentId, commentId };
    case "manager":
      return null;
    default:
      return author satisfies never;
  }
}

/** A comment's row id is its number: `m7` is row 7. */
const rowIdOf = (id: CommentId): number => Number(id.slice(1));
const idOfRowSchema = z.number().int().transform((id) => commentIdSchema.parse(`m${id}`));
const COLUMNS = "id, issue_id AS issueId, at, text, reply_to AS replyTo, author";
const commentRowSchema = commentSchema.extend({ id: idOfRowSchema, replyTo: idOfRowSchema.nullable(), author: json(commentAuthorSchema) });
const toComment = (row: unknown): Comment => commentRowSchema.parse(row);
