import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutOf, checkoutProblems, checkoutText } from "./checkout.ts";
import { firstVerdict } from "./verdict.ts";

const CLAIMED = "a".repeat(40);
const changed = (count: number) => Array.from({ length: count }, (_, i) => ({ path: `notes/${i + 1}.md`, status: "??" }));

test("the claimed commit on a clean tree has no problem, and says so as the plugin's read", () => {
  const checkout = checkoutOf(CLAIMED, [], 0);
  assert.deepEqual(checkoutProblems(CLAIMED, checkout), []);
  assert.equal(checkoutText(CLAIMED, checkout), `bb's git plugin read the agent's environment as it handed off: the claimed commit ${CLAIMED} checked out, on a clean working tree.`);
});

test("another commit and changed files are each a problem, in bb's words, with the files beyond the bound counted", () => {
  const checkout = checkoutOf("b".repeat(40), changed(23), 23);
  assert.equal(checkout.changedFiles.length, 20, "listed up to the bound");
  const [otherCommit, tree] = checkoutProblems(CLAIMED, checkout);
  assert.equal(otherCommit, `HEAD was ${"b".repeat(40)}, not the claimed ${CLAIMED}`);
  assert.match(tree ?? "", /^the working tree had 23 changed files: \?\? notes\/1\.md, \?\? notes\/2\.md, [^]*\?\? notes\/20\.md, and 3 more$/);
  assert.deepEqual(checkoutProblems(CLAIMED, checkoutOf(CLAIMED, changed(1), 1)), ["the working tree had 1 changed file: ?? notes/1.md"]);
});

test("a done handoff's first verdict: waived with verification off, Couldn't verify when bb couldn't read the checkout, else queued on it", () => {
  const read = { kind: "read", branch: null, checkout: checkoutOf(CLAIMED, [], 0) } as const;
  const unread = { kind: "unread", reason: "The environment's machine is offline" } as const;
  assert.deepEqual(firstVerdict(false, unread, 3_000), { state: "waived" }, "verification off reads nothing into it");
  assert.deepEqual(firstVerdict(true, read, 3_000), { state: "queued", checkout: read.checkout });
  assert.deepEqual(firstVerdict(true, unread, 3_000), {
    state: "could-not-run",
    at: 3_000,
    verifierThreadId: null,
    reason: "bb's git plugin couldn't read the agent's commit and working tree as it handed off (The environment's machine is offline)",
  });
});
