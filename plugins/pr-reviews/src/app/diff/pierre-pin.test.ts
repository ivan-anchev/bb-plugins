import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("@pierre/diffs is pinned to the version bb runs, 1.6.4", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.devDependencies["@pierre/diffs"], "1.6.4", "restore the pin after `bb plugin types`");
});
