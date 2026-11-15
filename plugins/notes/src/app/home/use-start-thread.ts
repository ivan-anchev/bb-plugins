// Start thread: the picked notes leave the card and become a brief appended to bb's new-thread
// composer. The user reviews and sends the draft themselves.
import { experimental_useRpcMutation, useComposer } from "@get-bb/plugin-sdk/app";
import { notesContract as contract, type Note } from "../../contract.ts";
import { appendToDraft } from "./append-to-draft.ts";

type NoteIds = readonly Note["id"][];

export function useStartThread() {
  // In a homepage section this is bb's main new-thread composer (spike Q1).
  const composer = useComposer();
  const brief = experimental_useRpcMutation({ contract, method: "briefFor" });
  const archive = experimental_useRpcMutation({ contract, method: "archiveNotes" });

  // why the scope, not the section's projectId prop: the prop stayed null in bb 0.49 (spike Q1). The
  // scope follows the project picker, and is proj_personal under "No project".
  const projectId = composer.scope.kind === "new-thread" ? composer.scope.projectId : null;

  /**
   * Brief, archive, then fill: the draft only ever gets notes that have left the card. If either call
   * fails the draft is untouched and the notes stay on the card, so starting again simply retries, and
   * no reload can put the same notes in the draft twice. `onFilled` runs once the draft holds the brief.
   */
  const run = (noteIds: NoteIds, onFilled: () => void) => {
    if (projectId === null) return;
    brief
      .mutate({ noteIds: [...noteIds], projectId })
      .then(async (draft) => {
        await archive.mutate({ noteIds: [...noteIds] });
        return draft;
      })
      .then(
        (draft) => {
          composer.replace((current) => appendToDraft(current, draft));
          composer.focus();
          onFilled();
        },
        // why swallowed: each mutation hook keeps its failure in `error`, which the card shows.
        () => undefined,
      );
  };

  return {
    /** False while bb is still resolving the composer's project. */
    ready: projectId !== null,
    isPending: brief.isPending || archive.isPending,
    // why brief first: a failed brief stops the run before archiving, so an archive error is then stale.
    error: (brief.error ?? archive.error)?.message ?? null,
    run,
  };
}
