// Agent- and user-written Markdown with its raw HTML made code, before bb's renderer draws it. why:
// bb's Markdown renders raw HTML through a sanitizer that keeps elements such as an <img>, and the
// SDK has no way to turn HTML off, so the text is parsed as bb parses it (micromark, CommonMark and
// GFM) and written out again, every raw HTML node as code. The writer escapes what it writes so it
// reads back as the same document, so no construct, a fence an HTML comment opened included, can
// turn the code back into HTML. Text without raw HTML is handed on as written.
import type { Nodes, Parent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown, type Handle } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

/** `text` as Markdown that holds no raw HTML: each piece of it, a tag, comment or block, is code, as written. */
export function inertHtml(text: string): string {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  if (!holdsHtml(tree)) return text;
  joinHtmlRuns(tree, text);
  return toMarkdown(tree, { extensions: [gfmToMarkdown()], handlers: { html: htmlAsCode } });
}

// ------------------------------------------------------------------ layer 2

function holdsHtml(node: Nodes): boolean {
  return node.type === "html" || ("children" in node && node.children.some(holdsHtml));
}

/**
 * Makes each run of raw HTML and code side by side, as `<span><b>` or `<b>`x`</b>`, one piece of raw
 * HTML holding the run's source as written. why: written as code one by one, their backticks would
 * meet and read as other code spans, showing stray backticks or handing a tag on as HTML.
 */
function joinHtmlRuns(parent: Parent, source: string): void {
  const { children } = parent;
  for (const child of children) if ("children" in child) joinHtmlRuns(child, source);
  for (let start = 0; start < children.length; start += 1) {
    const run = runFrom(children, start);
    if (run.length > 1 && run.some(({ type }) => type === "html")) children.splice(start, run.length, { type: "html", value: sourceOf(run, source) });
  }
}

/**
 * Writes raw HTML as code: inline, in place; a block, as a code block. why code, not escaped words:
 * GFM finds links in a text's words once they are parsed, escapes undone, so the words of
 * `<a href="https://example.com">the guide</a>` link `https://example.com">the`; nothing is linked
 * in code.
 */
const htmlAsCode: Handle = (node, parent, state, info) =>
  state.handle(state.stack.includes("phrasing") ? { type: "inlineCode", value: node.value } : { type: "code", lang: null, meta: null, value: node.value }, parent, state, info);

// ------------------------------------------------------------------ layer 3

/** The run of raw HTML and code from `start` on: none when that node is neither. */
function runFrom(children: RootContent[], start: number): RootContent[] {
  let end = start;
  while (end < children.length && (children[end]?.type === "html" || children[end]?.type === "inlineCode")) end += 1;
  return children.slice(start, end);
}

/** The source `run` was parsed from, from its first node's start to its last's end. */
const sourceOf = (run: RootContent[], source: string): string => source.slice(offsetOf(run[0]?.position?.start), offsetOf(run.at(-1)?.position?.end));

/** Where a parsed node starts or ends in its source. why a throw: the parser places every node it makes, so a node with no place is a bug here. */
function offsetOf(point: NonNullable<Nodes["position"]>["start"] | undefined): number {
  if (point?.offset === undefined) throw new Error("A parsed Markdown node has no place in its source.");
  return point.offset;
}
