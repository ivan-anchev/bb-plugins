// Agent- and user-written Markdown with its raw HTML made code, before bb's renderer draws it. why:
// bb's Markdown renders raw HTML through a sanitizer that keeps elements such as an <img>, and the
// SDK has no way to turn HTML off, so the text is parsed as bb parses it (micromark, CommonMark and
// GFM), every raw HTML node in the tree is made code holding its value, and the tree is written out
// again. The writer escapes what it writes so it reads back as the same document, so no construct, a
// fence an HTML comment opened included, can turn the code back into HTML. Text without raw HTML is
// handed on as written.
//
// why code, not words: bb takes Markdown as text and parses it again, and GFM finds links in a
// text's words once parsed, escapes undone, so the words of `<a href="https://example.com">the
// guide</a>` would link `https://example.com">the`; nothing is linked in code.
import type { Nodes, Parent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

/** `text` as Markdown that holds no raw HTML: each piece of it, a tag, comment or block, is code, as written. */
export function inertHtml(text: string): string {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  if (!holdsHtml(tree)) return text;
  htmlAsCode(tree);
  return toMarkdown(tree, { extensions: [gfmToMarkdown()] });
}

// ------------------------------------------------------------------ layer 2

function holdsHtml(node: Nodes): boolean {
  return node.type === "html" || ("children" in node && node.children.some(holdsHtml));
}

/**
 * Makes each raw HTML node under `parent` code holding its value: inline code among a paragraph's
 * words, a code block where a block stands. Then joins inline code side by side into one.
 */
function htmlAsCode(parent: Parent): void {
  const { children } = parent;
  children.forEach((child, n) => {
    if (child.type === "html") children[n] = BLOCK_HOLDERS.has(parent.type) ? { type: "code", lang: null, meta: null, value: child.value } : { type: "inlineCode", value: child.value };
    else if ("children" in child) htmlAsCode(child);
  });
  joinInlineCode(children);
}

/** The nodes whose raw HTML is a block: the rest hold a paragraph's words, or a cell's. */
const BLOCK_HOLDERS = new Set<string>(["root", "blockquote", "listItem", "footnoteDefinition"]);

/**
 * Joins inline code side by side into one, as `npm test` and a <br> right after it. why: written one
 * by one, their backticks would meet and read as other code spans. Parsed Markdown has no inline code
 * side by side, so only code made from HTML is joined.
 */
function joinInlineCode(children: RootContent[]): void {
  for (let n = children.length - 1; n > 0; n -= 1) {
    const [before, after] = [children[n - 1], children[n]];
    if (before?.type !== "inlineCode" || after?.type !== "inlineCode") continue;
    before.value += after.value;
    children.splice(n, 1);
  }
}
