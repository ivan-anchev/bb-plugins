// Delete on send (decision 28). New thread and Send to this thread leave the picked notes on the list,
// marked In draft (use-start-thread.ts). Mounted once per window, this watches every composer on
// screen: when one sends, it tells the server the draft it sent, and the server deletes the notes
// whose brief that draft held; when this window sees a brief leave a draft, its notes stop waiting.
// why `onSubmitted`, not a `message.dispatch` hook (spike, bb 0.49): it fires once bb has accepted
// the send, while the hook asks before it, and a later plugin can still make it wait or refuse it.
// Only the client sees a draft change, so the mark is cleared here either way.
import { experimental_useRpcMutation, useComposers, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import { toast } from "sonner"; // runtime-shimmed to bb's own toast
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

// ------------------------------------------------------------------ layer 2

type ComposerWatchProps = {
  composer: PluginComposerApi;
  /** Every draft notes wait in, as this window last read them. */
  drafts: readonly InDraft[];
  /** This composer sent `text`, its draft as it stood before the send. */
  onSent(composerKey: string, text: string): void;
  /** This window saw these briefs leave this composer's draft. */
  onDropped(gone: readonly InDraft[]): void;
};

function ComposerWatch({ composer, drafts, onSent, onDropped }: ComposerWatchProps) {
  const text = composer.draft.text;
  const waiting = useMemo(() => drafts.filter(({ composerKey }) => composerKey === composer.key), [drafts, composer.key]);
  /**
   * The draft as it stood when a send began. why kept (spike): bb empties the draft, with
   * `isSubmitting` set, before `onSubmitted` fires.
   */
  const beforeSend = useRef(text);
  const seen = useRef<SeenBriefs>(new Set());

  const judge = useEffectEvent(() => {
    if (composer.isSubmitting) return;
    beforeSend.current = text;
    const next = judgeDraft(seen.current, text, waiting);
    seen.current = next.seen;
    if (next.gone.length > 0) onDropped(next.gone);
  });
  // why on a change of either: a mark may arrive before or after the fill that holds its brief, and
  // the brief only counts as seen once both are here.
  useEffect(() => judge(), [text, waiting]);

  const submitted = useEffectEvent(() => {
    // why forget: the draft emptied because it was sent, not because the brief was taken out.
    seen.current = new Set();
    // why always, not only when a known brief is in it: this window's marks may not have loaded yet.
    onSent(composer.key, beforeSend.current);
  });
  useEffect(() => composer.onSubmitted(submitted), [composer]);

  return null;
}

/** A failed read of the marks: they may be stale, and none clears until a read succeeds. */
function useReportReadError(error: Error | null): void {
  useEffect(() => {
    if (error !== null) toast.error(`Couldn't read which notes are in a draft, so In draft may be out of date: ${error.message}`);
  }, [error]);
}

/** A failure the user should know of: the notes keep their mark, or stay on the list. */
function report(what: string) {
  return (error: Error) => {
    toast.error(`${what}: ${error.message}`);
  };
}
