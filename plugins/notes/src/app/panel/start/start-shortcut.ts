// The starts' shortcuts while notes are picked: ⌘↵ New thread; ⇧⌘↵ or ⌥⌘↵ Send to this thread (Ctrl
// for ⌘ off macOS). The Notes panel handles them itself, only while focus is inside it and not in a
// field: the note composer keeps its ⌘↵ for saving, and bb's composer never sees the panel's keys.
// why not app.commands: a global ⌘↵ would collide with bb's composer send (decision 33).

export type StartKind = "new-thread" | "this-thread";

/** The hint each start shows, and the keys it announces to assistive tech. */
export const START_SHORTCUTS = {
  "new-thread": { hint: "⌘↵", aria: "Meta+Enter Control+Enter" },
  "this-thread": { hint: "⇧⌘↵", aria: "Shift+Meta+Enter Alt+Meta+Enter Shift+Control+Enter Alt+Control+Enter" },
} as const satisfies Record<StartKind, { hint: string; aria: string }>;

type Chord = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** Which start a key press asks for, if any. */
export function startShortcut({ key, metaKey, ctrlKey, shiftKey, altKey }: Chord): StartKind | null {
  if (key !== "Enter" || !(metaKey || ctrlKey)) return null;
  return shiftKey || altKey ? "this-thread" : "new-thread";
}

/** Whether the press went to a field, which keeps its own ⌘↵. */
export function inTextField(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}
