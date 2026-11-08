import assert from "node:assert/strict";
import { test } from "node:test";
import { directImageUrl } from "./github-image-urls.ts";

const RAW = "https://raw.githubusercontent.com/ivan-anchev/bb-plugins/pr-assets/bb-pr-side-panel-v1/after-quiet.png";

const rewritten: [name: string, url: string, expected: string][] = [
  ["a blob ?raw=true link", "https://github.com/ivan-anchev/bb-plugins/blob/pr-assets/bb-pr-side-panel-v1/after-quiet.png?raw=true", RAW],
  ["a /raw/ link", "https://github.com/ivan-anchev/bb-plugins/raw/pr-assets/bb-pr-side-panel-v1/after-quiet.png", RAW],
  [
    "a ref with slashes",
    "https://github.com/o/r/raw/refs/heads/feature/x/shot.png",
    "https://raw.githubusercontent.com/o/r/refs/heads/feature/x/shot.png",
  ],
  [
    "a path with parentheses",
    "https://github.com/o/r/blob/main/shots/shot(1).png?raw=true",
    "https://raw.githubusercontent.com/o/r/main/shots/shot(1).png",
  ],
];

for (const [name, url, expected] of rewritten) {
  test(`directImageUrl points ${name} at raw.githubusercontent.com`, () => {
    assert.equal(directImageUrl(url), expected);
  });
}

const untouched: [name: string, url: string][] = [
  ["a blob link without ?raw=true", "https://github.com/o/r/blob/main/shot.png"],
  ["a blob link with another query", "https://github.com/o/r/blob/main/shot.png?raw=true&v=2"],
  ["an uploaded attachment", "https://github.com/user-attachments/assets/86dc59ec-972e-408b-8b08-4b35046d8dda"],
  ["an image on another host", "https://example.com/o/r/raw/main/shot.png"],
  ["a raw.githubusercontent.com link", RAW],
];

for (const [name, url] of untouched) {
  test(`directImageUrl leaves ${name} alone`, () => {
    assert.equal(directImageUrl(url), url);
  });
}
