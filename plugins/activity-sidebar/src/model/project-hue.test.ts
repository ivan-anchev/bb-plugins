import assert from "node:assert/strict";
import { test } from "node:test";
import { hueOf } from "./project-hue.ts";

// Expected hues worked out from Zeron's hue_of: n = (n*31 + byte) % 9973 over the key's bytes,
// then DEFAULT_HUES[n % 12 + 1] (Lua is 1-based).
test("an ASCII key hashes as Zeron's does", () => {
  assert.equal(hueOf("a"), "blue"); // n = 97, 97 % 12 = 1
  assert.equal(hueOf("prj_44xvzvx5c3"), "orange"); // n = 4424
});

test("a non-ASCII key hashes over its UTF-8 bytes, not its UTF-16 code units", () => {
  assert.equal(hueOf("é"), "pink"); // bytes c3 a9 → n = 6214; code unit 233 would give rose
  assert.equal(hueOf("プロジェクト"), "lime"); // n = 8646; code units would give blue
});

test("the same key always gets the same hue", () => {
  assert.equal(hueOf("prj_44xvzvx5c3"), hueOf("prj_44xvzvx5c3"));
});
