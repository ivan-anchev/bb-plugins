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

const NOT_TEXT = ":not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=file], [type=range], [type=color])";

/** Whether the press went to a field you type in, which keeps its own ⌘↵. */
export function inTextField(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches(`input${NOT_TEXT}, textarea, select`));
}
