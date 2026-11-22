import { experimental_Icon as Icon, experimental_PromptMentionIcon as MentionIcon } from "@get-bb/plugin-sdk/app";
import type { PickedThread } from "./mention-text.ts";

export function LinkChips({ threads, onUnlink }: { threads: readonly PickedThread[]; onUnlink(thread: PickedThread): void }) {
  if (threads.length === 0) return null;
  return (
    <ul className="nt-links" aria-label="Linked threads">
      {threads.map((thread) => (
        <li key={thread.title} className="nt-chip">
          <MentionIcon mention={{ kind: "thread", threadId: thread.threadId, label: thread.title }} className="nt-chip-icon" />
          <span className="nt-chip-title">{thread.title}</span>
          <button type="button" className="nt-chip-remove" aria-label={`Unlink ${thread.title}`} onClick={() => onUnlink(thread)}>
            <Icon name="X" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
