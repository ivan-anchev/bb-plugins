import assert from "node:assert/strict";
import { test } from "node:test";
import { hueOf } from "./project-hue.ts";

test("an ASCII key hashes as Zeron's does", () => {
  assert.equal(hueOf("a"), "blue");
  assert.equal(hueOf("prj_44xvzvx5c3"), "orange");
});

test("a non-ASCII key hashes over its UTF-8 bytes, not its UTF-16 code units", () => {
  assert.equal(hueOf("é"), "pink");
  assert.equal(hueOf("プロジェクト"), "lime");
});

test("the same key always gets the same hue", () => {
  assert.equal(hueOf("prj_44xvzvx5c3"), hueOf("prj_44xvzvx5c3"));
});
