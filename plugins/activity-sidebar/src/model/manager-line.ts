// A regional manager's line in the Managers view: the first sentence of its own latest reply, as plain
// words. Pure: a reply's markdown in, its first sentence out.
import { z } from "zod";

/** One manager's line, keyed by its thread; a manager with none has no entry. */
export const managerLineSchema = z.object({ threadId: z.string().min(1), line: z.string().min(1) });
export type ManagerLine = z.infer<typeof managerLineSchema>;

/**
 * The first sentence of `markdown` as plain words: code blocks dropped, block and inline marks
 * stripped (a link keeps its text), whitespace collapsed. A sentence ends at ". ", "! " or "? ", or
 * at its line's end. Null when nothing readable is left.
 */
export function firstSentence(markdown: string): string | null {
  for (const raw of withoutCodeBlocks(markdown).split("\n")) {
    const words = collapse(inlinePlain(blockPlain(raw)));
    if (words !== "") return words.match(SENTENCE)?.[0] ?? words;
  }
  return null;
}

// ------------------------------------------------------------------ layer 2

/** A sentence: up to its first ".", "!" or "?" that a space follows. */
const SENTENCE = /^.*?[.!?](?=\s)/;

/** Fenced code blocks, ``` or ~~~, closed or running to the end. */
const withoutCodeBlocks = (text: string): string => text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, "");

/** A line's block marks: heading, quote, list bullet or number, task box; a rule leaves nothing. */
function blockPlain(line: string): string {
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return "";
  return line
    .replace(/^\s*(>\s?)+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/\s+#+\s*$/, "");
}

/**
 * An inline link or image: its text, then its destination, which may be <bracketed>, hold balanced
 * parentheses (a wiki address), and carry a title.
 */
const LINK = /!?\[([^\]]*)\]\((?:\s*<[^>]*>|(?:[^()\s]|\((?:[^()\s]|\([^()\s]*\))*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** Inline marks: images and links keep their text, autolinks their address, code its words, emphasis loses its markers. */
function inlinePlain(text: string): string {
  return text
    .replace(LINK, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/`+([^`]+?)`+/g, "$1")
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1$2");
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
