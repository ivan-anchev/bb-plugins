// Start thread: the picked notes leave the list and become a brief appended to the composer on
// screen. On New thread that is bb's new-thread composer; on a thread page, that thread's (the button
// reads "Add to composer"). The user reviews and sends the draft themselves.
import { experimental_useRpcMutation, useBbContext, useComposer, useComposers, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { notesContract as contract, type Note } from "../../contract.ts";
import { appendToDraft } from "./append-to-draft.ts";

type NoteIds = readonly Note["id"][];

export function useStartThread() {
  const composer = useScreenComposer();
  const projectId = useProjectId(composer);
  const brief = experimental_useRpcMutation({ contract, method: "briefFor" });
  const archive = experimental_useRpcMutation({ contract, method: "archiveNotes" });

  /**
   * Brief, archive, then fill: the draft only ever gets notes that have left the list. If either call
   * fails the draft is untouched and the notes stay, so starting again simply retries, and no reload
   * can put the same notes in the draft twice. Once the draft holds the brief, the composer takes
   * focus and `onFilled` runs, unless `isCurrent` says the host that started it has gone by then.
   */
  const run = (noteIds: NoteIds, { onFilled, isCurrent }: { onFilled(): void; isCurrent(): boolean }) => {
    if (composer === null || projectId === null) return;
    brief
      .mutate({ noteIds: [...noteIds], projectId })
      .then(async (draft) => {
        await archive.mutate({ noteIds: [...noteIds] });
        return draft;
      })
      .then(
        (draft) => {
          composer.replace((current) => appendToDraft(current, draft));
          // why: focusing the composer would dismiss whatever popover opening is on screen now.
          if (!isCurrent()) return;
          composer.focus();
          onFilled();
        },
        // why swallowed: each mutation hook keeps its failure in `error`, which the panel shows.
        () => undefined,
      );
  };

  return {
    label: composer?.scope.kind === "thread" ? "Add to composer" : "Start thread",
    /** Why there is nothing to start into: no composer on this screen. */
    unavailable: composer === null ? "Open New thread or a thread to use notes." : null,
    /** False while bb is still resolving the composer's project. */
    ready: projectId !== null,
    isPending: brief.isPending || archive.isPending,
    // why brief first: a failed brief stops the run before archiving, so an archive error is then stale.
    error: (brief.error ?? archive.error)?.message ?? null,
    run,
  };
}

// ------------------------------------------------------------------ layer 2

/**
 * The composer the current screen shows, or null when it shows none (Tools, Settings).
 * why both hooks (spike, bb 0.49): from the popover's overlay `useComposer()` is the route's draft
 * even off screen, and its new-thread project never resolves there; `useComposers()` lists only the
 * composers on screen, with the project resolved. The route's draft, found among them, is the one.
 */
function useScreenComposer(): PluginComposerApi | null {
  const route = useComposer();
  return useComposers().find((composer) => composer.key === route.key) ?? null;
}

/**
 * Where the brief's files are uploaded. A new thread's is the project picker's (proj_personal under
 * "No project"; null while unresolved); a thread's is the project of the thread on screen.
 */
function useProjectId(composer: PluginComposerApi | null): string | null {
  const context = useBbContext();
  if (composer === null) return null;
  return composer.scope.kind === "new-thread" ? composer.scope.projectId : context.projectId;
}
