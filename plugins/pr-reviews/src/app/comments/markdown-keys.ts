// The comment box's markdown shortcuts: ⌘B, ⌘I, ⌘E and ⌘K (Ctrl off a Mac) wrap the selected text
// in bold, italic, inline code or a link. Pure: the box applies the result to its textarea.

/** A textarea's text and its selection. */
export type TextEdit = { text: string; start: number; end: number };

// With nothing selected, a placeholder word is wrapped and left selected, ready to type over.
const WRAPS: Record<string, { before: string; after: string; placeholder: string }> = {
  b: { before: "**", after: "**", placeholder: "bold" },
  i: { before: "_", after: "_", placeholder: "italic" },
  e: { before: "`", after: "`", placeholder: "code" },
  k: { before: "[", after: "](https://)", placeholder: "text" },
};

/** The edit a shortcut makes, with the wrapped text selected; null for any other key. */
export function markdownShortcut(key: string, { text, start, end }: TextEdit): TextEdit | null {
  const wrap = WRAPS[key.toLowerCase()];
  if (wrap === undefined) return null;
  const inner = start === end ? wrap.placeholder : text.slice(start, end);
  const from = start + wrap.before.length;
  return { text: `${text.slice(0, start)}${wrap.before}${inner}${wrap.after}${text.slice(end)}`, start: from, end: from + inner.length };
}
