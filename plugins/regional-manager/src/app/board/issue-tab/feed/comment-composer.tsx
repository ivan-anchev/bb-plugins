// The foot of an issue's Activity: a field to comment on the issue, which goes to its regional
// manager. ⌘↵ or Ctrl+↵ sends, Enter breaks the line; focus stays in the field through a send, and
// bb's Esc is held while it has text. The browser keeps what was typed, by issue, until the server
// took it, and a send that failed keeps it beside its error. A sent comment shows as a card saying
// so until the feed reads it, and while it is on its way no composer of the issue sends again.
import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useId, useSyncExternalStore, type KeyboardEvent } from "react";
import { coordinatorContract as contract } from "../../../../contract.ts";
import { MAX_ANSWER_CHARS } from "../../../../model/decision.ts";
import type { CommentId } from "../../../../model/feed/comment.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { useManagerName } from "../../../profile/use-manager.ts";
import { Button } from "../../../ui/button.tsx";
import { GrowingTextarea } from "../../../ui/growing-textarea.tsx";
import { useHoldEscape } from "../../../ui/hold-escape.ts";
import { useStored } from "../../../ui/stored.ts";
import { answerDraftSchema } from "../../answer-draft.ts";
import { SendingCard } from "./comment-card.tsx";

type CommentComposerProps = {
  coordinatorId: CoordinatorId;
  issueId: IssueId;
  /** The comments the feed has read, by id, which end a sent comment's card. */
  posted: ReadonlyMap<CommentId, unknown>;
};

export function CommentComposer({ coordinatorId, issueId, posted }: CommentComposerProps) {
  const ids = useId();
  const manager = useManagerName(coordinatorId);
  // why an answer's draft schema: a comment's bounds are an answer's (comment.ts).
  const key = commentDraftKeyOf(coordinatorId, issueId);
  const typed = useStored(localStorage, key, answerDraftSchema);
  const draft = typed.value ?? "";
  // why only the draft sent: the field may hold a newer one by then, typed after a remount or in another tab.
  const { sent, send, error } = usePost(coordinatorId, issueId, key, (sentDraft) => typed.update((current) => (current === sentDraft ? null : current)));
  useHoldEscape(draft !== "");

  const sending = sent !== null && sent.commentId === null;
  const showing = sent !== null && (sent.commentId === null || !posted.has(sent.commentId));

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(draft);
  }

  return (
    <div className="rmi-composer">
      {showing && <SendingCard text={sent.text} commentId={sent.commentId} />}
      <form
        aria-label={`Comment on ${issueId}`}
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={`${ids}-field`} className="sr-only">
          Comment on {issueId}
        </label>
        <GrowingTextarea
          id={`${ids}-field`}
          value={draft}
          onChange={(event) => typed.store(event.target.value === "" ? null : event.target.value)}
          onKeyDown={onKeyDown}
          // why readOnly, not disabled: a disabled field drops focus to the page while the comment sends.
          readOnly={sending}
          maxLength={MAX_ANSWER_CHARS}
          placeholder={`Comment on ${issueId}`}
          aria-describedby={`${ids}-hint`}
        />
        <div className="rmi-composer-foot">
          <p id={`${ids}-hint`} className="rmi-composer-hint">
            Goes to {manager} · {SEND_KEYS} sends
          </p>
          {/* why aria-disabled, not disabled: a disabled button drops focus to the page while the comment sends. */}
          <Button type="submit" variant="default" size="sm" aria-disabled={sending || draft.trim() === ""}>
            Comment
          </Button>
        </div>
        {error !== null && (
          <p role="alert" className="rmi-decision-error">
            Could not post your comment: {error.message}
          </p>
        )}
      </form>
    </div>
  );
}

/** Where the browser keeps the comment typed on one issue. */
const commentDraftKeyOf = (coordinatorId: CoordinatorId, issueId: IssueId): string => `coordinator-issue-comment:${coordinatorId}:${issueId}`;

/** The keys that send, as this machine names them. */
const SEND_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘↵" : "Ctrl+↵";

/** A comment sent from Send: its id once the server took it (null: on its way). */
type Sent = { text: string; commentId: CommentId | null };

/**
 * The comment last sent on each issue, by its draft's key, kept outside the composer. why: bb
 * remounts the panel when it redraws it, which drops a component's state, and a composer mounted
 * while a comment is on its way would otherwise send the same draft again.
 */
const sentByKey = new Map<string, Sent>();
const sentListeners = new Set<() => void>();

function setSent(key: string, sent: Sent | null): void {
  if (sent === null) sentByKey.delete(key);
  else sentByKey.set(key, sent);
  for (const listener of sentListeners) listener();
}

function subscribeSent(listener: () => void): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

/**
 * Posts one comment at a time on the issue whose draft is under `key`, across the composer's
 * mounts: `sent` is the comment sent, with its id once the server took it (null: none sent, or the
 * send failed, whose error is `error`). `taken` runs with the draft sent as the server takes it.
 */
function usePost(coordinatorId: CoordinatorId, issueId: IssueId, key: string, taken: (draft: string) => void) {
  const save = experimental_useRpcMutation({ contract, method: "commentIssue" });
  const sent = useSyncExternalStore(subscribeSent, () => sentByKey.get(key) ?? null);

  function send(draft: string): void {
    const text = draft.trim();
    // why read now, not the render's: a second press, or a composer mounted meanwhile, must see the first send.
    if (sentByKey.get(key)?.commentId === null || text === "") return;
    setSent(key, { text, commentId: null });
    save.mutate({ coordinatorId, issueId, text, replyTo: null }).then(
      ({ commentId }) => {
        setSent(key, { text, commentId });
        taken(draft);
      },
      // why nothing more: the hook's error shows beside the draft, which is kept.
      () => setSent(key, null),
    );
  }

  return { sent, send, error: sent === null ? save.error : null };
}
