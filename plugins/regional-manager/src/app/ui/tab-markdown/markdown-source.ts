// Agent- and user-written Markdown with its raw HTML made words, before bb's renderer draws it. why:
// bb's Markdown renders raw HTML through a sanitizer that keeps elements such as an <img>, and the
// SDK has no way to turn HTML off, so the text is parsed as bb parses it (micromark, CommonMark and
// GFM) and written out again, every raw HTML node as escaped text. The writer escapes what it writes
// so it reads back as the same document, so no construct, a fence an HTML comment opened included,
// can turn the words back into HTML. Text without raw HTML is handed on as written.
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown, type Handle } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

/** `text` as Markdown that holds no raw HTML: each piece of it, a tag, comment or block, is the words it is written as. */
export function inertHtml(text: string): string {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  return holdsHtml(tree) ? toMarkdown(tree, { extensions: [gfmToMarkdown()], handlers: { html: htmlAsWords } }) : text;
}

// ------------------------------------------------------------------ layer 2

function holdsHtml(node: Nodes): boolean {
  return node.type === "html" || ("children" in node && node.children.some(holdsHtml));
}

/**
 * Writes raw HTML as escaped words: inline, in place; a block, as a paragraph of them. why a
 * paragraph: the writer escapes `<` only in a paragraph's words (phrasing), and a block's words stand
 * where a block does.
 */
const htmlAsWords: Handle = (node, parent, state, info) =>
  state.stack.includes("phrasing") ? state.safe(node.value, info) : state.handle({ type: "paragraph", children: [{ type: "text", value: node.value }] }, parent, state, info);
