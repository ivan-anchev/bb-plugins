import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { InboxPr, PrState } from "../contract.ts";
import { repoSchema } from "../github/repo.ts";
import { createSidebarCatchUp } from "./sidebar-catch-up.ts";

const REPO = repoSchema.parse("octo-org/widgets");
const READ_EVERY_MS = 3_000;

const listedAs = (state: PrState, repo = REPO): InboxPr => ({
  projectId: "proj_1",
  repo,
  number: 7,
  title: "Add a widget",
  author: "octocat",
  state,
  updatedAt: "2026-11-12T10:00:00Z",
  mergedAt: null,
  baseRefName: "main",
  headRefName: "add-widget",
  ciFailing: false,
  changesRequested: false,
  section: "authored",
});

// GitHub's search stands in: each read serves the next of `reads`, then the last one again.
// `read` resolves only when the test lets it, so a read can be left in flight.
function sidebar(t: TestContext, reads: (() => Promise<InboxPr[]>)[]) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = { reads: 0, invalidations: 0 };
  const catchUp = createSidebarCatchUp({
    readListed: () => reads[Math.min(seen.reads++, reads.length - 1)](),
    invalidate: () => void seen.invalidations++,
  });
  // Lets one pause run out and the read after it settle.
  const wait = async (pauses = 1) => {
    for (let pause = 0; pause < pauses; pause++) {
      t.mock.timers.tick(READ_EVERY_MS);
      await new Promise(setImmediate);
    }
  };
  return { catchUp, seen, wait };
}
const serves = (...prs: InboxPr[]) => async () => prs;

test("the sidebar re-reads until search lists the PR in its new state, then the app re-reads it once", async (t) => {
  const { catchUp, seen, wait } = sidebar(t, [serves(listedAs("OPEN")), serves(), serves(listedAs("CLOSED"))]);

  catchUp.follow(REPO, 7, "close");
  await wait(2);
  assert.deepEqual(seen, { reads: 2, invalidations: 0 });

  await wait();
  assert.deepEqual(seen, { reads: 3, invalidations: 1 });

  await wait(10);
  assert.deepEqual(seen, { reads: 3, invalidations: 1 });
});

test("a reopened PR that was closed as a draft is caught up as a draft, under GitHub's spelling of the repo", async (t) => {
  const { catchUp, seen, wait } = sidebar(t, [serves(listedAs("DRAFT", repoSchema.parse("Octo-Org/Widgets")))]);

  catchUp.follow(REPO, 7, "reopen");
  await wait();

  assert.deepEqual(seen, { reads: 1, invalidations: 1 });
});

test("a failed read reads as not caught up, and the next read tries again", async (t) => {
  const { catchUp, seen, wait } = sidebar(t, [async () => assert.fail("GitHub is down"), serves(listedAs("DRAFT"))]);

  catchUp.follow(REPO, 7, "draft");
  await wait(2);

  assert.deepEqual(seen, { reads: 2, invalidations: 1 });
});

test("a search that never lists the new state stops after six reads, with no re-read", async (t) => {
  const { catchUp, seen, wait } = sidebar(t, [serves(listedAs("DRAFT"))]);

  catchUp.follow(REPO, 7, "ready");
  await wait(20);

  assert.deepEqual(seen, { reads: 6, invalidations: 0 });
});

test("dispose cancels the pending pause, and nothing is followed after it", async (t) => {
  const { catchUp, seen, wait } = sidebar(t, [serves(listedAs("CLOSED"))]);

  catchUp.follow(REPO, 7, "close");
  catchUp.dispose();
  catchUp.follow(REPO, 7, "close");
  await wait(10);

  assert.deepEqual(seen, { reads: 0, invalidations: 0 });
});

test("a read in flight when the plugin is disposed re-reads nothing, even once search caught up", async (t) => {
  let answer = (_prs: InboxPr[]) => {};
  const { catchUp, seen, wait } = sidebar(t, [() => new Promise((resolve) => (answer = resolve))]);

  catchUp.follow(REPO, 7, "close");
  await wait();
  catchUp.dispose();
  answer([listedAs("CLOSED")]);
  await wait(10);

  assert.deepEqual(seen, { reads: 1, invalidations: 0 });
});
