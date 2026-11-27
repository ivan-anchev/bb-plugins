import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Locator, Page } from "playwright-core";
import { chromeWith, settled } from "../../../../test-chrome.ts";
import { ADJACENT_TAGS, HTML_EXAMPLE, LONG_FIRST_SENTENCE, REST, SWEEP } from "./texts.ts";

// The feed's cards as Chrome lays them out, at the panel's usual width (549px) and a phone's (360px):
// a folded decision shows its first sentence whole however long it runs, to its last letter wherever
// on its line it ends, and cuts the rest until opened; one that opens on a list is cut to three lines
// until opened; and a comment's HTML is code, as written, with no link found in its tag.

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

test("at 360px, every folded first sentence is drawn to its last letter as it is opened, wherever on its line it ends", async () => {
  const page = await chrome.open(360);
  const sweep = page.getByRole("region", { name: "Sweep" });
  const folded = await lastLines(sweep);
  assert.equal(folded.length, SWEEP.length);
  assert.ok(folded.some(({ room }) => room < 13), "some sentence ends within an ellipsis' width of its line's end");
  const foldedShots = await Promise.all(folded.map((line) => shot(page, line)));
  for (const press of await sweep.locator(".rmi-clamp-press").all()) await press.click();
  await settled(page);
  const opened = await lastLines(sweep);
  const openedShots = await Promise.all(opened.map((line) => shot(page, line)));
  const differ = SWEEP.filter((_, n) => !foldedShots[n].equals(openedShots[n])).map((sentence) => sentence.slice(-8));
  assert.deepEqual(differ, [], "each sentence's last line drawn the same, folded and opened");
});

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

test("a comment holding an HTML example shows its tags as code, as written, and no link is made from inside them; tags side by side show as written too", async () => {
  const page = await chrome.open(360);
  const markdown = page.getByRole("article", { name: "Comment m1" }).locator("[data-markdown-preview]");
  const drawn = await markdown.evaluate((box) => ({ text: box.textContent, code: [...box.querySelectorAll("code")].map((code) => code.textContent), links: box.querySelectorAll("a").length }));
  assert.deepEqual(drawn, { text: HTML_EXAMPLE, code: ['<a href="https://example.com/guide">', "</a>"], links: 0 });
  const adjacent = await page.getByRole("article", { name: "Comment m2" }).locator("[data-markdown-preview]").evaluate((box) => ({ text: box.textContent, links: box.querySelectorAll("a").length }));
  assert.deepEqual(adjacent, { text: ADJACENT_TAGS, links: 0 }, "tags side by side shown as written");
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

/** Where each sweep decision's first sentence ends, as laid out: its last line, from the line's start to the sentence's end, in the page; and the room left on that line after it. */
function lastLines(sweep: Locator) {
  return sweep.locator(".rmi-clamp p").evaluateAll((paragraphs) =>
    paragraphs.map((paragraph) => {
      const words = paragraph.firstChild;
      if (!(words instanceof Text)) throw new Error("a sweep paragraph isn't its decision's words");
      const range = document.createRange();
      range.setStart(words, 0);
      range.setEnd(words, words.data.indexOf("!") + 1);
      const end = [...range.getClientRects()].at(-1) ?? new DOMRect();
      const line = paragraph.getBoundingClientRect();
      return { x: Math.floor(line.left), y: Math.floor(end.top + scrollY), width: Math.ceil(end.right) - Math.floor(line.left), height: Math.ceil(end.height), room: line.right - end.right };
    }),
  );
}

/** The pixels of `clip` on the page. */
const shot = (page: Page, { x, y, width, height }: { x: number; y: number; width: number; height: number }) => page.screenshot({ clip: { x, y, width, height }, fullPage: true });
