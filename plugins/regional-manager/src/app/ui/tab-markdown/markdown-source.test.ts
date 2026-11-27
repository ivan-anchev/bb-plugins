import assert from "node:assert/strict";
import { test } from "node:test";
import { firstMarkdownSentence, inertHtml } from "./markdown-source.ts";

// Markdown the tab hands bb's renderer: raw HTML made text, and a decision's headline cut only where
// no Markdown runs across the cut.

test("raw HTML, inline or a block, is handed on as the text it is written as, so no element or script can come of it", () => {
  assert.equal(
    inertHtml('Raw: <img src=x onerror="window.hit=1"> and <script>window.hit=2</script> end.'),
    'Raw: &lt;img src=x onerror="window.hit=1"> and &lt;script>window.hit=2&lt;/script> end.',
  );
  assert.equal(inertHtml("<div>\n*kept*\n</div>\n\nafter"), "&lt;div>\n*kept*\n&lt;/div>\n\nafter");
  assert.equal(inertHtml("<!-- hidden -->\n\ntext"), "&lt;!-- hidden -->\n\ntext");
  assert.equal(inertHtml("| a |\n|---|\n| <img src=y> |"), "| a |\n|---|\n| &lt;img src=y> |", "in a GFM table's cell too");
});

test("a < that opens no HTML, in code, an autolink or plain words, is left as written", () => {
  const text = "Code `<b>` and\n\n```html\n<div>\n```\n\nsee <https://example.com>, <a@b.co>, and a < b > c";
  assert.equal(inertHtml(text), text);
});

test("a decision's headline ends at its first sentence, as written, its line breaks and closing quotes included", () => {
  assert.deepEqual(firstMarkdownSentence("Cap retries\nat five. Each retry waits.\nThe fifth gives up."), { sentence: "Cap retries\nat five.", rest: "Each retry waits.\nThe fifth gives up." });
  assert.deepEqual(firstMarkdownSentence("“Use the read-only default.”\nThe sandbox writes nowhere else."), { sentence: "“Use the read-only default.”", rest: "The sandbox writes nowhere else." });
  assert.deepEqual(firstMarkdownSentence("One."), { sentence: "One.", rest: null });
});

test("a decision's headline never ends inside a link, code or emphasis, so each part is whole Markdown", () => {
  assert.deepEqual(firstMarkdownSentence("Follow [Retries. A migration guide](https://example.com/retries). Then more."), { sentence: "Follow [Retries. A migration guide](https://example.com/retries).", rest: "Then more." });
  assert.deepEqual(firstMarkdownSentence("Use `x.y. z` now. Rest."), { sentence: "Use `x.y. z` now.", rest: "Rest." });
  assert.deepEqual(firstMarkdownSentence("Use **bold. text** now. Rest."), { sentence: "Use **bold. text** now.", rest: "Rest." });
});

test("without a sentence end in its first paragraph's words, a decision's headline is its first block", () => {
  assert.deepEqual(firstMarkdownSentence("No end here\n\nSecond paragraph."), { sentence: "No end here", rest: "Second paragraph." });
  assert.deepEqual(firstMarkdownSentence("- a. b\n- c\n\nAfter."), { sentence: "- a. b\n- c", rest: "After." });
});
