import assert from "node:assert/strict";
import { test } from "node:test";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { inertHtml } from "./markdown-source.ts";

// The Markdown the tab hands bb's renderer holds no raw HTML: read back as bb reads it, every piece
// of HTML is words, and nothing else changes.

/** `markdown` read as bb's renderer reads it: its raw HTML nodes, its words, and its code blocks' contents. */
function readBack(markdown: string) {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const all = (node: Nodes): Nodes[] => [node, ...("children" in node ? node.children.flatMap(all) : [])];
  const nodes = all(tree);
  return {
    html: nodes.filter((node) => node.type === "html").map((node) => node.value),
    words: nodes.flatMap((node) => (node.type === "text" ? [node.value] : [])).join("|"),
    code: nodes.flatMap((node) => (node.type === "code" ? [node.value] : [])),
  };
}

test("an HTML comment that wraps a fence, then a fenced <img onerror> and <script>, hands on no HTML: the comment is words and the fence's HTML stays code", () => {
  const read = readBack(inertHtml('<!--\n```\n-->\n```\n<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>\n```'));
  assert.deepEqual(read.html, []);
  assert.equal(read.words, "<!--\n```\n-->");
  assert.deepEqual(read.code, ['<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>']);
});

test("an HTML comment that opens a fence it never closes hands on no HTML", () => {
  const read = readBack(inertHtml('<!--\n```\n-->\n<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>\n```\n\nafter'));
  assert.deepEqual(read.html, []);
  assert.match(read.words, /<img src=x onerror="window\.hit=1">\n<script>window\.hit=2<\/script>/);
});

test("raw HTML inline, in a block, a list, a quote and a table's cell is handed on as the words it is written as", () => {
  /** Each text, and its words as read back, one text node after another. */
  const cases: [string, string][] = [
    ['Raw: <img src=x onerror="window.hit=1"> and <script>window.hit=2</script> end.', 'Raw: <img src=x onerror="window.hit=1"> and <script>window.hit=2</script> end.'],
    ["<div>\n# not a heading\n</div>", "<div>\n# not a heading\n</div>"],
    ["- <b>x</b>\n- <div>y</div>\n\n> <img src=q>", "<b>x</b>|<div>y</div>|<img src=q>"],
    ["| a |\n|---|\n| <img src=y> |", "a|<img src=y>"],
  ];
  for (const [text, words] of cases) {
    const read = readBack(inertHtml(text));
    assert.deepEqual(read.html, [], text);
    assert.equal(read.words, words, text);
  }
});

test("text with no raw HTML is handed on exactly as written, a < in code, an autolink or plain words included", () => {
  for (const text of ["Code `<b>` and\n\n```html\n<div>\n```\n\nsee <https://example.com>, <a@b.co>, and a < b > c", "See [the guide][g].\n\n[g]: https://example.com/guide", "Run this.\n\n    npm test"]) assert.equal(inertHtml(text), text);
});
