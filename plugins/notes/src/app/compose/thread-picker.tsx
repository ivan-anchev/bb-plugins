import { experimental_PromptMentionIcon as MentionIcon, experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useId, useState, type KeyboardEvent } from "react";
import type { PickedThread } from "./mention-text.ts";

type ThreadMatches = ReturnType<typeof useThreadMatches>;

/**
 * The matches for `query` (null: no @ query at the caret), the highlighted one, and the keys. A new
 * query starts at the top match. `dismiss` (Esc) hides the picker until the query changes.
 */
export function useThreadMatches(query: string | null) {
  const matches = useMatches(query);
  const [seen, setSeen] = useState({ query, highlighted: 0, dismissed: false });
  if (seen.query !== query) setSeen({ query, highlighted: 0, dismissed: false });
  const highlighted = Math.min(seen.highlighted, matches.length - 1);
  const isOpen = query !== null && !seen.dismissed;
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-${index}`;
  const highlight = (index: number) => setSeen((current) => ({ ...current, highlighted: index }));

  const onKeyDown = (event: KeyboardEvent, pick: (thread: PickedThread) => void): boolean => {
    if (!isOpen || matches.length === 0) return false;
    const step = STEPS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      highlight((highlighted + step + matches.length) % matches.length);
      return true;
    }
    if (!isPickKey(event)) return false;
    event.preventDefault();
    pick(matches[highlighted]);
    return true;
  };

  return {
    isOpen,
    query: query ?? "",
    matches,
    highlighted,
    optionId,
    highlight,
    onKeyDown,
    dismiss: () => setSeen((current) => ({ ...current, dismissed: true })),
    fieldProps: {
      "aria-autocomplete": "list",
      "aria-controls": isOpen && matches.length > 0 ? listboxId : undefined,
      "aria-activedescendant": isOpen && matches.length > 0 ? optionId(highlighted) : undefined,
    } as const,
    listboxId,
  };
}

export function ThreadPicker({ picker, onPick }: { picker: ThreadMatches; onPick(thread: PickedThread): void }) {
  return (
    <div className="nt-picker" onMouseDown={(event) => event.preventDefault()}>
      <div className="nt-picker-label">Link a thread</div>
      {picker.matches.length === 0 ? (
        <p className="nt-picker-none">No thread matches “{picker.query}”</p>
      ) : (
        <ul className="nt-picker-list" id={picker.listboxId} role="listbox" aria-label="Link a thread">
          {picker.matches.map((thread, index) => (
            <li
              key={thread.threadId}
              id={picker.optionId(index)}
              className="nt-picker-row"
              role="option"
              aria-selected={index === picker.highlighted}
              onMouseMove={() => picker.highlight(index)}
              onClick={() => onPick(thread)}
            >
              <MentionIcon mention={{ kind: "thread", threadId: thread.threadId, label: thread.title }} className="nt-picker-icon" />
              <span className="nt-picker-title">{thread.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MAX_MATCHES = 5;

const STEPS: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

function isPickKey(event: KeyboardEvent): boolean {
  const alone = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  return alone && (event.key === "Enter" || event.key === "Tab");
}

function useMatches(query: string | null): PickedThread[] {
  const { threads } = experimental_useSidebarThreads();
  if (query === null) return [];
  const needle = query.toLowerCase();
  return threads
    .filter((thread) => thread.displayTitle.toLowerCase().includes(needle))
    .slice(0, MAX_MATCHES)
    .map((thread) => ({ threadId: thread.id, title: thread.displayTitle }));
}
