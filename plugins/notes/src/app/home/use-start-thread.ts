// Start thread: the picked notes become a brief appended to bb's new-thread composer, then leave the
// card. The user reviews and sends the draft themselves.
import { experimental_useRpcMutation, useComposer } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { notesContract as contract, type Note } from "../../contract.ts";
import { appendToDraft } from "./append-to-draft.ts";

type NoteIds = readonly Note["id"][];

export function useStartThread() {
  // In a homepage section this is bb's main new-thread composer (spike Q1).
  const composer = useComposer();
  const brief = experimental_useRpcMutation({ contract, method: "briefFor" });
  const archive = experimental_useRpcMutation({ contract, method: "archiveNotes" });
  // Notes already in the draft whose archive failed: they must leave the card, never be briefed twice.
  // Until they do, no new run starts, so a retry archives exactly them.
  const [unarchived, setUnarchived] = useState<NoteIds>([]);

  // why the scope, not the section's projectId prop: the prop stayed null in bb 0.49 (spike Q1). The
  // scope follows the project picker, and is proj_personal under "No project".
  const projectId = composer.scope.kind === "new-thread" ? composer.scope.projectId : null;
  const ready = projectId !== null && unarchived.length === 0;

  /** Rejects when archiving fails, after keeping the notes for a retry. */
  const archiveUsed = (noteIds: NoteIds) =>
    archive.mutate({ noteIds: [...noteIds] }).then(
      () => setUnarchived([]),
      (error: unknown) => {
        setUnarchived(noteIds);
        throw error;
      },
    );

  /**
   * Fill first, archive second: if the brief fails nothing is archived, and if archiving fails the
   * notes are already safe in the draft, so only the archive is retried. `onFilled` runs once the
   * draft holds the brief.
   */
  const run = (noteIds: NoteIds, onFilled: () => void) => {
    if (!ready) return;
    brief.mutate({ noteIds: [...noteIds], projectId }).then(
      (draft) => {
        composer.replace((current) => appendToDraft(current, draft));
        composer.focus();
        onFilled();
        // why swallowed: a failure is kept in `unarchived`, which the card offers to retry.
        archiveUsed(noteIds).catch(() => undefined);
      },
      // why swallowed: the hook keeps the failure in `brief.error`, which the card shows.
      () => undefined,
    );
  };

  return {
    /** False while bb is still resolving the composer's project, or while notes in the draft wait for their archive. */
    ready,
    isPending: brief.isPending || archive.isPending,
    error: brief.error?.message ?? null,
    run,
    /** Archives the notes left on the card by a failed archive, or null when there are none. Rejects when it fails again. */
    retryArchive: unarchived.length === 0 ? null : () => archiveUsed(unarchived),
  };
}
