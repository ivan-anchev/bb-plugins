import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Locator } from "playwright-core";
import { chromeWith, settled } from "../../../../test-chrome.ts";
import { HTML_EXAMPLE, LONG_FIRST_SENTENCE, REST } from "./texts.ts";

// The feed's cards as Chrome lays them out, at the panel's usual width (549px) and a phone's (360px):
// a folded decision shows its first sentence whole however long it runs, and cuts the rest until
// opened; one that opens on a list is cut to three lines until opened; and a comment's HTML example
// is code, with no link found in its tag.

const chrome = await chromeWith(new URL("./page.tsx", import.meta.url));
after(() => chrome.close());

for (const width of [360, 549]) {
  test(`at ${width}px, a folded decision shows its first sentence whole though it wraps past three lines, and the rest stays cut until opened`, async () => {
    const page = await chrome.open(width);
    const press = page.getByRole("button", { name: /^Cap every webhook retry/ });
    const folded = await sentences(press);
    assert.equal(folded.open, "false");
    assert.ok(folded.firstLines > 3, `the first sentence runs ${folded.firstLines} lines`);
    assert.ok(folded.firstFoot <= folded.shownFoot + 0.5, `the first sentence ends at ${folded.firstFoot}px, inside the fold, which ends at ${folded.shownFoot}px`);
    assert.ok(folded.restFoot > folded.shownFoot + 1, "the rest runs past the fold");
    await press.click();
    await settled(page);
    const opened = await sentences(press);
    assert.equal(opened.open, "true");
    assert.ok(opened.restFoot <= opened.shownFoot + 0.5, "opened, the rest is shown whole");
  });
}

test("at 360px, a decision that opens on a list is three lines tall until opened, then tall enough for the whole list", async () => {
  const page = await chrome.open(360);
  const press = page.getByRole("button", { name: /^Cap retries:/ });
  const folded = await heights(press);
  assert.equal(folded.open, "false");
  assert.ok(Math.abs(folded.height - (folded.itemFeet[1] - folded.top)) < 1, `folded, ${folded.height}px: its first line, then the list's to "two", its third line`);
  assert.ok(folded.itemFeet[2] > folded.top + folded.height + 1, '"three" is cut');
  await press.click();
  await settled(page);
  const opened = await heights(press);
  assert.equal(opened.open, "true");
  assert.ok(opened.height > folded.height && opened.top + opened.height >= opened.itemFeet[4] - 0.5, `opened, ${opened.height}px: down to "five"`);
});

test("a comment holding an HTML example shows its tags as code, as written, and no link is made from inside them", async () => {
  const page = await chrome.open(360);
  const markdown = page.getByRole("article", { name: "Comment m1" }).locator("[data-markdown-preview]");
  const drawn = await markdown.evaluate((box) => ({ text: box.textContent, code: [...box.querySelectorAll("code")].map((code) => code.textContent), links: box.querySelectorAll("a").length }));
  assert.deepEqual(drawn, { text: HTML_EXAMPLE, code: ['<a href="https://example.com/guide">', "</a>"], links: 0 });
  const mangled = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")).filter((href) => /%22|%3E/i.test(href ?? "")));
  assert.deepEqual(mangled, [], "no link on the page holds a quote or a > of the tag");
});

/** The long decision's cut, as laid out: whether it is open, the foot of what it shows, and the lines and foot of its first sentence and of the rest. */
async function sentences(press: Locator) {
  const paragraph = press.locator(".rmi-clamp p");
  const parts = await paragraph.evaluate(
    (paragraph, [first, rest]) => {
      const words = paragraph.firstChild;
      if (!(words instanceof Text) || words.data !== `${first} ${rest}`) throw new Error("the paragraph isn't the decision's words");
      const boxOf = (part: string) => {
        const range = document.createRange();
        range.setStart(words, words.data.indexOf(part));
        range.setEnd(words, words.data.indexOf(part) + part.length);
        return range.getBoundingClientRect();
      };
      const firstBox = boxOf(first);
      return { firstLines: Math.round(firstBox.height / parseFloat(getComputedStyle(paragraph).lineHeight)), firstFoot: firstBox.bottom, restFoot: boxOf(rest).bottom };
    },
    [LONG_FIRST_SENTENCE, REST],
  );
  return { open: await press.getAttribute("aria-expanded"), shownFoot: await foot(press.locator(".rmi-clamp")), ...parts };
}

/** The list decision's cut, as laid out: whether it is open, its top and height, and the foot of each of its list's items. */
async function heights(press: Locator) {
  const shown = await press.locator(".rmi-clamp").evaluate((text) => ({ top: text.getBoundingClientRect().top, height: text.getBoundingClientRect().height }));
  const itemFeet = await press.locator("li").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().bottom));
  assert.equal(itemFeet.length, 5, "the list's five items");
  return { open: await press.getAttribute("aria-expanded"), top: shown.top, height: shown.height, itemFeet };
}

/** Where `element`'s box ends down the page. */
const foot = (element: Locator) => element.evaluate((box) => box.getBoundingClientRect().bottom);
