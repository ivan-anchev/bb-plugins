import assert from "node:assert/strict";
import { test } from "node:test";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { inertHtml } from "./markdown-source.ts";

// The Markdown the tab hands bb's renderer holds no raw HTML: read back as bb reads it, every piece
// of HTML is code, as written, with no link found in it, and nothing else changes.

/** `markdown` read as bb's renderer reads it, GFM's links found: its raw HTML nodes, its words, its code, inline and in blocks, and its links' targets. */
function readBack(markdown: string) {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const all = (node: Nodes): Nodes[] => [node, ...("children" in node ? node.children.flatMap(all) : [])];
  const nodes = all(tree);
  return {
    html: nodes.filter((node) => node.type === "html").map((node) => node.value),
    words: nodes.flatMap((node) => (node.type === "text" ? [node.value] : [])).join("|"),
    code: nodes.flatMap((node) => (node.type === "code" || node.type === "inlineCode" ? [node.value] : [])),
    links: nodes.flatMap((node) => (node.type === "link" ? [node.url] : [])),
  };
}

test("an HTML example's link stays code: no link is found in its tag, and the words between its tags stay words", () => {
  const read = readBack(inertHtml('See <a href="https://example.com/guide">the guide</a>.'));
  assert.deepEqual(read, { html: [], words: "See |the guide|.", code: ['<a href="https://example.com/guide">', "</a>"], links: [] });
});

test("tags side by side, and tags beside code, read back as one piece of code holding their words, with no backtick shown and no tag handed on as HTML", () => {
  /** Each text, then its code and its words as read back, one node after another. */
  const cases: [string, string[], string][] = [
    ["See <span><b>example</b></span>.", ["<span><b>", "</b></span>"], "See |example|."],
    ["Run `npm test`<br>Then review the output.", ["npm test<br>"], "Run |Then review the output."],
    ["<b>`x`</b> and `y`<i>", ["<b>x</b>", "y<i>"], " and "],
    ["<a title='`'>x</a><b title='``'>", ["<a title='`'>", "</a><b title='``'>"], "x"],
    ["x <b> `y`", ["<b>", "y"], "x | "],
    ["| a |\n|---|\n| <b><i>z</i></b> |", ["<b><i>", "</i></b>"], "a|z"],
  ];
  for (const [text, code, words] of cases) {
    const read = readBack(inertHtml(text));
    assert.deepEqual(read.html, [], text);
    assert.deepEqual(read.code, code, text);
    assert.equal(read.words, words, text);
  }
});

test("an HTML comment that wraps a fence, then a fenced <img onerror> and <script>, hands on no HTML: the comment is code, and the fence's HTML stays code", () => {
  const read = readBack(inertHtml('<!--\n```\n-->\n```\n<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>\n```'));
  assert.deepEqual(read.html, []);
  assert.deepEqual(read.code, ["<!--\n```\n-->", '<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>']);
});

test("an HTML comment that opens a fence it never closes hands on no HTML", () => {
  const read = readBack(inertHtml('<!--\n```\n-->\n<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>\n```\n\nafter'));
  assert.deepEqual(read.html, []);
  assert.deepEqual(read.code, ["<!--\n```\n-->", '<img src=x onerror="window.hit=1">\n<script>window.hit=2</script>\n```']);
  assert.equal(read.words, "after");
});

test("HTML comments on a quote's lines are code inside the quote, with no quote marker in them", () => {
  const tree = fromMarkdown(inertHtml("> <!-- first -->\n> <!-- second -->"), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  assert.deepEqual(
    tree.children.map((node) => (node.type === "blockquote" ? node.children.map((inside) => (inside.type === "code" ? inside.value : inside.type)) : node.type)),
    [["<!-- first -->", "<!-- second -->"]],
  );
});

test("raw HTML inline, in a block, a list, a quote and a table's cell is handed on as code, as written, around the same words", () => {
  /** Each text, then its code and its words as read back, one node after another. */
  const cases: [string, string[], string][] = [
    ['Raw: <img src=x onerror="window.hit=1"> and <script>window.hit=2</script> end.', ['<img src=x onerror="window.hit=1">', "<script>", "</script>"], "Raw: | and |window.hit=2| end."],
    ["<div>\n# not a heading\n</div>", ["<div>\n# not a heading\n</div>"], ""],
    ["- <b>x</b>\n- <div>y</div>\n\n> <img src=q>", ["<b>", "</b>", "<div>y</div>", "<img src=q>"], "x"],
    ["| a |\n|---|\n| <img src=y> |", ["<img src=y>"], "a"],
  ];
  for (const [text, code, words] of cases) {
    const read = readBack(inertHtml(text));
    assert.deepEqual(read.html, [], text);
    assert.deepEqual(read.code, code, text);
    assert.equal(read.words, words, text);
  }
});

test("text with no raw HTML is handed on exactly as written, a < in code, an autolink or plain words included", () => {
  for (const text of ["Code `<b>` and\n\n```html\n<div>\n```\n\nsee <https://example.com>, <a@b.co>, and a < b > c", "See [the guide][g].\n\n[g]: https://example.com/guide", "Run this.\n\n    npm test"]) assert.equal(inertHtml(text), text);
});
