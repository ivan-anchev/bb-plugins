import assert from "node:assert/strict";
import { test } from "node:test";
import { hueOf } from "./project-hue.ts";

// The same cases as activity-sidebar's project-hue.test.ts: a project must wear the same hue in both.
test("a key hashes over its UTF-8 bytes as Zeron's hue_of does", () => {
  assert.equal(hueOf("a"), "blue");
  assert.equal(hueOf("prj_44xvzvx5c3"), "orange");
  assert.equal(hueOf("é"), "pink");
  assert.equal(hueOf("プロジェクト"), "lime");
});
