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
  const mark = experimental_useRpcMutation({ contract, method: "putInDraft" });

  const fill = ({ composer, projectId }: Target, noteIds: NoteIds, { isCurrent }: StartOptions) =>
    brief
      .mutate({ noteIds: [...noteIds], projectId })
      .then(async (draft) => {
        await mark.mutate({ composerKey: composer.key, brief: draft.text, noteIds: [...noteIds] });
        return draft;
      })
      .then(
        (draft) => {
          composer.replace((current) => appendToDraft(current, draft));
          if (isCurrent()) composer.focus();
          return true;
        },
        () => false,
      );

  const newThread: Start = (noteIds, options) => reachNewThread().then((target) => fill(target, noteIds, options));
  const sendHere: Start | null = thisThread === null ? null : (noteIds, options) => fill(thisThread, noteIds, options);

  return {
    newThread,
    thisThread: sendHere,
    error: (brief.error ?? mark.error)?.message ?? null,
  };
}

function useScreenComposer(): PluginComposerApi | null {
  const route = useComposer();
  return useComposers().find((composer) => composer.key === route.key) ?? null;
}

function useThisThread(screen: PluginComposerApi | null): Target | null {
  const { projectId } = useBbContext();
  if (screen?.scope.kind !== "thread" || projectId === null) return null;
  return { composer: screen, projectId };
}

function useReachNewThread(screen: PluginComposerApi | null): () => Promise<Target> {
  const navigate = useBbNavigate();
  const arrival = useRef<((target: Target) => void) | null>(null);
  const here = screen?.scope.kind === "new-thread" && screen.scope.projectId !== null ? { composer: screen, projectId: screen.scope.projectId } : null;

  useEffect(() => {
    if (here === null || arrival.current === null) return;
    arrival.current(here);
    arrival.current = null;
  });

  return () => {
    if (here !== null) return Promise.resolve(here);
    if (screen?.scope.kind !== "new-thread") navigate.toCompose();
    return new Promise((resolve) => {
      arrival.current = resolve;
    });
  };
}
