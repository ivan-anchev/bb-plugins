// Starting from notes: the picked notes leave the list and become a brief appended to a composer,
// either bb's new-thread composer (from any screen: off New thread, bb goes there first) or the
// composer of the thread on screen. The user reviews and sends the draft themselves.
import {
  experimental_useRpcMutation,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposers,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { notesContract as contract, type Note } from "../../../contract.ts";
import { appendToDraft } from "./append-to-draft.ts";

type NoteIds = readonly Note["id"][];

/** A composer the brief can go to, with the project its files upload into. */
type Target = { composer: PluginComposerApi; projectId: string };

/** `isCurrent`: whether the host that started it is still on screen once the draft holds the brief. */
type StartOptions = { isCurrent(): boolean };

/** Resolves whether the draft got the brief; never rejects. */
export type Start = (noteIds: NoteIds, options: StartOptions) => Promise<boolean>;

export function useStartThread() {
  const screen = useScreenComposer();
  const reachNewThread = useReachNewThread(screen);
  const thisThread = useThisThread(screen);
  const brief = experimental_useRpcMutation({ contract, method: "briefFor" });
  const archive = experimental_useRpcMutation({ contract, method: "archiveNotes" });

  /**
   * Brief, archive, then fill: the draft only ever gets notes that have left the list. If either call
   * fails the draft is untouched and the notes stay, so starting again simply retries, and no reload
   * can put the same notes in the draft twice. Once the draft holds the brief, the composer takes
   * focus, unless `isCurrent` says the host that started it has gone by then.
   */
  const fill = ({ composer, projectId }: Target, noteIds: NoteIds, { isCurrent }: StartOptions) =>
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
          if (isCurrent()) composer.focus();
          return true;
        },
        // why swallowed: each mutation hook keeps its failure in `error`, which the panel shows.
        () => false,
      );

  /** Into bb's new-thread composer, going to New thread first when another screen shows. */
  const newThread: Start = (noteIds, options) => reachNewThread().then((target) => fill(target, noteIds, options));
  /** Into the composer of the thread on screen; null where no thread is on screen. */
  const sendHere: Start | null = thisThread === null ? null : (noteIds, options) => fill(thisThread, noteIds, options);

  return {
    newThread,
    thisThread: sendHere,
    // why brief first: a failed brief stops the run before archiving, so an archive error is then stale.
    error: (brief.error ?? archive.error)?.message ?? null,
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

/** The thread on screen's composer; its files upload into that thread's project. */
function useThisThread(screen: PluginComposerApi | null): Target | null {
  const { projectId } = useBbContext();
  if (screen?.scope.kind !== "thread" || projectId === null) return null;
  return { composer: screen, projectId };
}

/**
 * Resolves the new-thread composer once it is on screen with its project resolved (the project
 * picker's; proj_personal under "No project"): at once on New thread, else after bb navigates there.
 * why the panel waits for it rather than writing after navigating (spike, bb 0.49): until New thread
 * is on screen there is no handle to its draft from a thread page, nor a project from Tools; the
 * popover stays open across the navigation (notes-popover.tsx), so this panel sees it arrive.
 */
function useReachNewThread(screen: PluginComposerApi | null): () => Promise<Target> {
  const navigate = useBbNavigate();
  const arrival = useRef<((target: Target) => void) | null>(null);
  const here = screen?.scope.kind === "new-thread" && screen.scope.projectId !== null ? { composer: screen, projectId: screen.scope.projectId } : null;

  // why after every render: `here` is rebuilt on each one, and the ref says whether a start waits.
  useEffect(() => {
    if (here === null || arrival.current === null) return;
    arrival.current(here);
    arrival.current = null;
  });

  return () => {
    if (here !== null) return Promise.resolve(here);
    // why not on New thread itself: there bb is only resolving the project, and the draft is here.
    if (screen?.scope.kind !== "new-thread") navigate.toCompose();
    return new Promise((resolve) => {
      arrival.current = resolve;
    });
  };
}
