import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SKILL_PATH, withCurrentSpec } from "./skill-spec.ts";

test("the skill's component reference matches OpenUI's library (run `npm run skill` to update)", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");
  assert.equal(skill, withCurrentSpec(skill));
});

test("a skill without the generated-section markers is refused", () => {
  assert.throws(() => withCurrentSpec("# Generative UI\n"), /no generated-section markers/);
});
