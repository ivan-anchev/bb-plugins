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
 * first sentence (firstSentenceEnd), on one line, cut to `max` characters (clipped).
 */
export function headline(text: string, max: number): string {
  const trimmed = text.trim();
  return clipped(trimmed.slice(0, firstSentenceEnd(trimmed)), max);
}

/**
 * Where text's first sentence ends, as an index just past it: past its full stop, question or
 * exclamation mark and any closing quotes or brackets right after it (”, ’, ", ', ), ]), before
 * whitespace or the text's end; the text's length when no sentence ends in it. why only those: a
 * line break mid-sentence, as in text wrapped by hand, ends no sentence.
 */
export function firstSentenceEnd(text: string): number {
  const end = SENTENCE_END.exec(text);
  return end === null ? text.length : end.index + end[0].length;
}

/** A sentence's last mark and the closing quotes and brackets after it, then whitespace or the end. */
const SENTENCE_END = /[.!?][”’"')\]]*(?=\s|$)/;
