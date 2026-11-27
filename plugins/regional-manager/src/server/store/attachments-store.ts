// Attachment bytes: one row each in attachment_files, written in the transaction that stores the
// handoff or verdict they belong to, and deleted only with their regional manager (removeCoordinator).
// Their records live in that handoff's or verdict's JSON (model/attachment.ts).
import { z } from "zod";
import { attachmentTypeSchema, type Attachment, type AttachmentId, type CopiedAttachment } from "../../model/attachment.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Db } from "./rows.ts";

/** An attachment's file: its name as given, its bytes, and the type they are served as. why instanceof: better-sqlite3 reads a BLOB as a Buffer, a Uint8Array. */
const fileRowSchema = z.object({ name: z.string().min(1), type: attachmentTypeSchema, bytes: z.instanceof(Uint8Array) });
type AttachmentFile = z.infer<typeof fileRowSchema>;

/**
 * Stores each copied attachment's bytes under its manager, and returns the records its owner keeps,
 * without the bytes. Call inside the transaction that stores the owner: a failed write here undoes
 * the owner's, and a failed owner write undoes these.
 */
export function insertAttachments(db: Db, coordinatorId: CoordinatorId, copied: readonly CopiedAttachment[]): Attachment[] {
  const insert = db().prepare("INSERT INTO attachment_files (id, coordinator_id, name, type, bytes) VALUES (?, ?, ?, ?, ?)");
  return copied.map(({ bytes, ...attachment }) => {
    insert.run(attachment.id, coordinatorId, attachment.name, attachment.type, bytes);
    return attachment;
  });
}

export function attachmentsStore(db: Db) {
  return {
    /** The attachment's file: its name, bytes and type; null when its manager holds none by that id. */
    attachmentFile(coordinatorId: CoordinatorId, id: AttachmentId): AttachmentFile | null {
      const row = db().prepare("SELECT name, type, bytes FROM attachment_files WHERE id = ? AND coordinator_id = ?").get(id, coordinatorId);
      return row === undefined ? null : fileRowSchema.parse(row);
    },
  };
}
