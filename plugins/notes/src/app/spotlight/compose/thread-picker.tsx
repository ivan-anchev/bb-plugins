// The @ picker under the Spotlight's textarea: the user's active threads whose title holds the
// query, five at most. Focus stays in the textarea; it drives the list with ↑↓ Enter Tab.
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
  // why state set while rendering: the query comes from the text, and a new one resets the picker.
  if (seen.query !== query) setSeen({ query, highlighted: 0, dismissed: false });
  const highlighted = Math.min(seen.highlighted, matches.length - 1);
  const isOpen = query !== null && !seen.dismissed;
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-${index}`;
  const highlight = (index: number) => setSeen((current) => ({ ...current, highlighted: index }));

  /** Handles ↑↓ Enter Tab while there are matches; returns whether it took the key. */
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
    /** The textarea's half of the listbox pattern: which list it drives, and the active option. */
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
    // why: a click anywhere in the picker must not take focus from the textarea, where the caret is.
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

// ------------------------------------------------------------------ layer 2

const MAX_MATCHES = 5;

const STEPS: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/** Enter or Tab, alone: ⌘↵ still saves, ⇧↵ still breaks the line, ⇧Tab still moves focus back. */
function isPickKey(event: KeyboardEvent): boolean {
  const alone = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  return alone && (event.key === "Enter" || event.key === "Tab");
}

/** Active threads only (the SDK's default): an archived thread is rarely worth linking in a note. */
function useMatches(query: string | null): PickedThread[] {
  const { threads } = experimental_useSidebarThreads();
  if (query === null) return [];
  const needle = query.toLowerCase();
  return threads
    .filter((thread) => thread.displayTitle.toLowerCase().includes(needle))
    .slice(0, MAX_MATCHES)
    .map((thread) => ({ threadId: thread.id, title: thread.displayTitle }));
}
