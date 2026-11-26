// Text the plugin shows one item to a line: a doorbell gives each update one line, and a line
// break would start another; a button holds one line; the issue's feed shows each headline as a
// row.

/** No line break anywhere: U+2028 and U+2029 are line breaks too. */
export const ONE_LINE = /^[^\r\n\u2028\u2029]*$/;

/** Text on one line, its whitespace runs made one space, cut with an ellipsis to `max` characters. */
export function clipped(text: string, max: number): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A headline for text written before it had one, as a stored record's parse derives it once: its
 * first sentence (to the first full stop, question or exclamation mark before a space or a line
 * break, else its first line), cut to `max` characters (clipped).
 */
export function headline(text: string, max: number): string {
  const sentence = /^\s*(.+?[.!?])(?=\s|$)/u.exec(text)?.[1] ?? text.trim().split(/[\r\n\u2028\u2029]/)[0] ?? "";
  return clipped(sentence, max);
}
