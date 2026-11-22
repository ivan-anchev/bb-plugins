import type { KeyboardEvent } from "react";

export const NEW_NOTE_SHORTCUT = { key: "j", mod: true, shift: true } as const;

/** The default only: a binding changed in Settings → Keyboard still opens, but Esc then closes. */
export function isNewNoteShortcut(event: KeyboardEvent): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === NEW_NOTE_SHORTCUT.key;
}
