// A regional manager's line in the Managers view: the first sentence of its own latest reply, as plain
// words. Pure: a reply's markdown in, its first sentence out.
import { lexer, type Token, type Tokens } from "marked";
import { z } from "zod";

/** One manager's line, keyed by its thread; a manager with none has no entry. */
export const managerLineSchema = z.object({ threadId: z.string().min(1), line: z.string().min(1) });
export type ManagerLine = z.infer<typeof managerLineSchema>;

/**
 * The first sentence of `markdown` as plain words: the text of its first block that has any (code,
 * rules and HTML have none; a quote or a list is read into), links, images and emphasis reduced to
 * their words, whitespace collapsed. A sentence ends at ". ", "! " or "? ", or at its line's end.
 * Null when nothing readable is left.
 */
export function firstSentence(markdown: string): string | null {
  const text = firstText(lexer(markdown));
  if (text === null) return null;
  const line = collapse(text.split("\n").find((part) => part.trim() !== "") ?? "");
  return line.match(SENTENCE)?.[0] ?? line;
}

/** `line` with each bb thread mention (`@thread:<id>`, perhaps to one message) named as bb shows it: by the thread's title, or "a thread" when the sidebar doesn't hold it. */
export function namingThreads(line: string, titleOf: (threadId: string) => string | undefined): string {
  return line.replace(/@thread:([\w-]+)(?:#msg=\d+)?/g, (_, threadId: string) => titleOf(threadId) ?? "a thread");
}

// ------------------------------------------------------------------ layer 2

/** A sentence: up to its first ".", "!" or "?" that a space follows. */
const SENTENCE = /^.*?[.!?](?=\s)/;

/** The words of the first of `blocks` that has any, a quote's or a list's read from their own blocks; null for none. */
function firstText(blocks: readonly Token[]): string | null {
  for (const block of blocks) {
    const text = blockText(block);
    if (text !== null && text.trim() !== "") return text;
  }
  return null;
}

/**
 * why `?? NONE` and the default: marked's tokens include extensions' generic ones, which may share a
 * name and carry no children; a block it doesn't know has no words here.
 */
function blockText(block: Token): string | null {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "text":
      return block.tokens === undefined ? block.text : words(block.tokens);
    case "blockquote":
      return firstText(block.tokens ?? NONE);
    case "list":
      return firstText(block.items.flatMap((item: Tokens.ListItem) => item.tokens));
    default:
      return null;
  }
}

/** Inline tokens as the words they show: emphasis, links and images by their text, code by its content, HTML tags dropped. */
function words(tokens: readonly Token[]): string {
  return tokens.map(inlineText).join("");
}

function inlineText(token: Token): string {
  switch (token.type) {
    case "text":
      return token.tokens === undefined ? token.text : words(token.tokens);
    case "escape":
    case "codespan":
      return token.text;
    case "strong":
    case "em":
    case "del":
      return words(token.tokens ?? NONE);
    // why: a label's own brackets ("[the [public] report]") are its nesting, not its words.
    case "link":
      return words(token.tokens ?? NONE).replace(/[[\]]/g, "");
    case "image":
      return token.text;
    case "br":
      return "\n";
    default:
      return "";
  }
}

const NONE: readonly Token[] = [];

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
