// Agent- and user-written Markdown, read as bb's renderer reads it (CommonMark and GFM, by micromark)
// before the tab hands it over: its raw HTML made the text it is written as, and a recorded
// decision's headline cut where no Markdown runs across the cut. why read here: bb's Markdown draws
// raw HTML through its sanitizer, which keeps an element such as an <img>, and the plugin can't turn
// HTML off in it; only the parse knows which `<` opens HTML and which sits in code or an autolink.
import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { sentenceEnd } from "../../../model/one-line.ts";

/** `text` with every piece of raw HTML in it, a tag, comment or block, made the text it is written as: drawn, it is words, never an element. */
export function inertHtml(text: string): string {
  // why from the last: each escape lengthens the text after it, and the spans before keep their offsets.
  return htmlSpans(parse(text)).reduceRight((inert, { start, end }) => `${inert.slice(0, start)}${inert.slice(start, end).replaceAll("<", "&lt;")}${inert.slice(end)}`, text);
}

/**
 * Text split after its first sentence, as firstSentence (model/one-line.ts) splits it, at a sentence
 * end in the plain words of its first paragraph, never inside a link, code or emphasis, so each part
 * is whole Markdown. Without one there, the first block is the sentence. The rest is null when none.
 */
export function firstMarkdownSentence(text: string): { sentence: string; rest: string | null } {
  const trimmed = text.trim();
  const cut = headlineEnd(trimmed, parse(trimmed));
  const rest = trimmed.slice(cut).trim();
  return { sentence: trimmed.slice(0, cut).trim(), rest: rest === "" ? null : rest };
}

// ------------------------------------------------------------------ layer 2

/** Where a span of the source starts and ends. */
type Span = { start: number; end: number };

const parse = (text: string): Root => fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

/** A node's span of the source. why the source, not the parsed value: the source is what is handed on. why throw: a parse of source text places every node. */
function spanOf(node: Nodes): Span {
  const { start, end } = node.position ?? {};
  if (start?.offset === undefined || end?.offset === undefined) throw new Error(`The Markdown parse placed no ${node.type}.`);
  return { start: start.offset, end: end.offset };
}

/** Every raw HTML node's span, inline or block, at any depth. */
function htmlSpans(node: Nodes): Span[] {
  if (node.type === "html") return [spanOf(node)];
  return "children" in node ? node.children.flatMap(htmlSpans) : [];
}

/** Where the headline of `text` ends: the first sentence end in a plain-text run of its first paragraph, else its first block's end. */
function headlineEnd(text: string, tree: Root): number {
  const first = tree.children[0];
  if (first === undefined) return text.length;
  const runs = first.type === "paragraph" ? first.children.filter((child) => child.type === "text").map(spanOf) : [];
  for (const run of runs) {
    const cut = sentenceEnd(text, run.start);
    if (cut !== null && cut <= run.end) return cut;
  }
  return spanOf(first).end;
}
