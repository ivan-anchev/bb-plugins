import { experimental_useRpcMutation, useComposers, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import { toast } from "sonner";
import { notesContract as contract, type InDraft } from "../../contract.ts";
import { useInDrafts } from "../use-notes.ts";
import { judgeDraft, type SeenBriefs } from "./seen-briefs.ts";

const NONE: readonly InDraft[] = [];

export function InDraftWatch() {
  const composers = useComposers();
  const drafts = useInDrafts();
  const sent = experimental_useRpcMutation({ contract, method: "draftSent" });
  const leave = experimental_useRpcMutation({ contract, method: "leaveDraft" });
  useReportReadError(drafts.error);

  const onSent = (composerKey: string, text: string) => sent.mutate({ composerKey, text }).catch(report("Couldn't delete the notes you sent"));
  const onDropped = (gone: readonly InDraft[]) =>
    gone.forEach(({ composerKey, brief }) => leave.mutate({ composerKey, brief }).catch(report("Couldn't clear In draft")));

  return composers.map((composer) => (
    <ComposerWatch key={composer.key} composer={composer} drafts={drafts.data ?? NONE} onSent={onSent} onDropped={onDropped} />
  ));
}

type ComposerWatchProps = {
  composer: PluginComposerApi;
  drafts: readonly InDraft[];
  onSent(composerKey: string, text: string): void;
  onDropped(gone: readonly InDraft[]): void;
};

function ComposerWatch({ composer, drafts, onSent, onDropped }: ComposerWatchProps) {
  const text = composer.draft.text;
  const waiting = useMemo(() => drafts.filter(({ composerKey }) => composerKey === composer.key), [drafts, composer.key]);
  const beforeSend = useRef(text);
  const seen = useRef<SeenBriefs>(new Set());

  const judge = useEffectEvent(() => {
    if (composer.isSubmitting) return;
    beforeSend.current = text;
    const next = judgeDraft(seen.current, text, waiting);
    seen.current = next.seen;
    if (next.gone.length > 0) onDropped(next.gone);
  });
  useEffect(() => judge(), [text, waiting]);

  const submitted = useEffectEvent(() => {
    seen.current = new Set();
    onSent(composer.key, beforeSend.current);
  });
  useEffect(() => composer.onSubmitted(submitted), [composer]);

  return null;
}

function useReportReadError(error: Error | null): void {
  useEffect(() => {
    if (error !== null) toast.error(`Couldn't read which notes are in a draft, so In draft may be out of date: ${error.message}`);
  }, [error]);
}

function report(what: string) {
  return (error: Error) => {
    toast.error(`${what}: ${error.message}`);
  };
}
