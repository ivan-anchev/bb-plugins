import assert from "node:assert/strict";
import { test } from "node:test";
import { hostCommandEnvironment } from "./host-command.ts";

test("the command inherits our environment, with the quiet overrides on top", () => {
  const pager = process.env.GH_PAGER;
  process.env.GH_PAGER = "less";
  try {
    const env = hostCommandEnvironment();
    assert.ok(process.env.HOME);
    assert.equal(env.HOME, process.env.HOME);
    assert.equal(env.GH_PAGER, "cat");
    assert.equal(env.GH_PROMPT_DISABLED, "1");
  } finally {
    if (pager === undefined) delete process.env.GH_PAGER;
    else process.env.GH_PAGER = pager;
  }
});
