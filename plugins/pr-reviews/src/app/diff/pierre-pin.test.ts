import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// bb 0.49 runs @pierre/diffs 1.6.4 for plugins, but declares ~1.2.12, and `bb plugin types` writes
// that into package.json: the types then lose the 1.6 API the app draws diffs with.
test("@pierre/diffs is pinned to the version bb runs, 1.6.4", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.devDependencies["@pierre/diffs"], "1.6.4", "restore the pin after `bb plugin types`");
});
