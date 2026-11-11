// The Summary tab's composer: the comment box at the foot of the activity, always there, that
// comments on the PR's conversation. Quote on a message puts its text in as a quote, after any
// draft, and takes the reader there; nothing posts before Comment. After a post the box says so
// where the text was, and Done gives back an empty box. The posted comment shows in the
// activity, which its post re-reads.
import { useState } from "react";
import { CommentBox } from "../comments/comment-box.tsx";
import { stageAfter, withQuote, WRITING, type BoxOutcome, type BoxStage } from "../diff/line-selection.ts";
import type { PrHeadTarget } from "../queries.ts";

/** The draft, how far the box has got, and how many times it was opened: each opening draws it afresh and gives it focus. */
type ComposerState = { draft: string; stage: BoxStage; opened: number };

export function useConversationComposer() {
  const [state, setState] = useState<ComposerState>({ draft: "", stage: WRITING, opened: 0 });
  const reopened = (current: ComposerState, draft: string): ComposerState => ({ draft, stage: WRITING, opened: current.opened + 1 });
  return {
    state,
    quote: (quote: string) => setState((current) => reopened(current, withQuote(current.draft, quote))),
    setDraft: (draft: string) => setState((current) => ({ ...current, draft })),
    settle: (outcome: BoxOutcome, sent: string) =>
      setState((current) => {
        const stage = stageAfter(current.draft, outcome, sent);
        return { ...current, stage, draft: stage.kind === "done" ? "" : current.draft };
      }),
    close: () => setState((current) => reopened(current, "")),
  };
}

export type ConversationComposerState = ReturnType<typeof useConversationComposer>;

export function ConversationComposer({ head, composer }: { head: PrHeadTarget; composer: ConversationComposerState }) {
  const { state } = composer;
  return (
    <CommentBox
      key={state.opened}
      subject={CONVERSATION}
      head={head}
      stage={state.stage}
      takeFocus={state.opened > 0}
      draft={state.draft}
      onDraft={composer.setDraft}
      onSettled={composer.settle}
      onClose={composer.close}
    />
  );
}

const CONVERSATION = { kind: "conversation" } as const;
