// The first sentence of Markdown bb has drawn (tab-markdown.tsx), as a range of its text: from its
// first words to where the sentence ends (one-line.ts), within the block those words stand in, such
// as a paragraph, a heading or a list's item. why the block: a sentence ends with its paragraph, as
// "Cap retries:" ends before the list under it.
import { firstSentenceEnd } from "../../../model/one-line.ts";

/** The range of `drawn`'s first sentence (null: no words drawn yet, as while bb's renderer loads). */
export function firstSentence(drawn: HTMLElement): Range | null {
  const texts = textsIn(drawn);
  const first = texts.find((text) => /\S/.test(text.data));
  if (first === undefined) return null;
  const block = blockOf(first, drawn);
  const words = texts.slice(texts.indexOf(first)).filter((text) => block.contains(text));
  const range = document.createRange();
  range.setStart(first, 0);
  endAt(range, words, firstSentenceEnd(words.map((text) => text.data).join("")));
  return range;
}

// ------------------------------------------------------------------ layer 2

/** Every text node in `node`, in reading order. */
const textsIn = (node: Node): Text[] => (node instanceof Text ? [node] : [...node.childNodes].flatMap(textsIn));

/** The nearest box around `text` that isn't drawn inline, as a paragraph is and a link or code isn't; `drawn` itself at most. */
function blockOf(text: Text, drawn: HTMLElement): HTMLElement {
  for (let element = text.parentElement; element !== null && element !== drawn; element = element.parentElement) {
    if (!getComputedStyle(element).display.startsWith("inline")) return element;
  }
  return drawn;
}

/** Ends `range` `at` characters into the words, read one text node after another. */
function endAt(range: Range, words: Text[], at: number): void {
  let left = at;
  for (const text of words) {
    if (left <= text.length) {
      range.setEnd(text, left);
      return;
    }
    left -= text.length;
  }
}
