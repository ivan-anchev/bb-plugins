// Agent- and user-written Markdown with its raw HTML made code, before bb's renderer draws it. why:
// bb's Markdown renders raw HTML through a sanitizer that keeps elements such as an <img>, and the
// SDK has no way to turn HTML off, so the text is parsed as bb parses it (micromark, CommonMark and
// GFM) and written out again, every raw HTML node as code. The writer escapes what it writes so it
// reads back as the same document, so no construct, a fence an HTML comment opened included, can
// turn the code back into HTML. Text without raw HTML is handed on as written.
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown, type Handle } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

/** `text` as Markdown that holds no raw HTML: each piece of it, a tag, comment or block, is code, as written. */
export function inertHtml(text: string): string {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  return holdsHtml(tree) ? toMarkdown(tree, { extensions: [gfmToMarkdown()], handlers: { html: htmlAsCode } }) : text;
}

// ------------------------------------------------------------------ layer 2

function holdsHtml(node: Nodes): boolean {
  return node.type === "html" || ("children" in node && node.children.some(holdsHtml));
}

/**
 * Writes raw HTML as code: inline, in place; a block, as a code block. why code, not escaped words:
 * GFM finds links in a text's words once they are parsed, escapes undone, so the words of
 * `<a href="https://example.com">the guide</a>` link `https://example.com">the`; nothing is linked
 * in code.
 */
const htmlAsCode: Handle = (node, parent, state, info) =>
  state.handle(state.stack.includes("phrasing") ? { type: "inlineCode", value: node.value } : { type: "code", lang: null, meta: null, value: node.value }, parent, state, info);
