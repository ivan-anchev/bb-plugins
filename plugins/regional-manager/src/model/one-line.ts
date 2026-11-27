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
 * first sentence (firstSentence), on one line, cut to `max` characters (clipped).
 */
export function headline(text: string, max: number): string {
  return clipped(firstSentence(text).sentence, max);
}

/**
 * Text split after its first sentence, as written: the sentence, then the rest (null: none). A
 * sentence ends at a full stop, question or exclamation mark, with any closing quotes or brackets
 * right after it (”, ’, ", ', ), ]), before whitespace or the text's end. why only those: a line
 * break mid-sentence, as in text wrapped by hand, ends no sentence.
 */
export function firstSentence(text: string): { sentence: string; rest: string | null } {
  const trimmed = text.trim();
  const end = SENTENCE_END.exec(trimmed);
  if (end === null) return { sentence: trimmed, rest: null };
  const cut = end.index + end[0].length;
  const rest = trimmed.slice(cut).trim();
  return { sentence: trimmed.slice(0, cut), rest: rest === "" ? null : rest };
}

/** A sentence's last mark and the closing quotes and brackets after it, then whitespace or the end. */
const SENTENCE_END = /[.!?][”’"')\]]*(?=\s|$)/;
