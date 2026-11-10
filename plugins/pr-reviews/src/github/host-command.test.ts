import assert from "node:assert/strict";
import { test } from "node:test";
import { hostCommandEnvironment, parseHostCommandFailure } from "./host-command.ts";

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

test("a failure carries the exit code and output; killed says whether the timeout stopped it", () => {
  assert.deepEqual(parseHostCommandFailure(Object.assign(new Error("Command failed"), { code: 1, stdout: "{}", stderr: "gh: Not Found (HTTP 404)\n" })), {
    code: 1,
    stdout: "{}",
    stderr: "gh: Not Found (HTTP 404)\n",
    killed: false,
  });
  assert.equal(parseHostCommandFailure(Object.assign(new Error("Command failed"), { code: null, killed: true, signal: "SIGTERM", stdout: "", stderr: "" })).killed, true);
  // A spawn error has no output at all.
  assert.deepEqual(parseHostCommandFailure(Object.assign(new Error("spawn E2BIG"), { code: "E2BIG" })), { code: "E2BIG", stdout: "", stderr: "", killed: false });
});
