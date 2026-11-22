import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { roundBodyKey } from "../../../../../contract.ts";
import type { Entry } from "../../../../../model/feed/entry.ts";
import { bodyOf, COORDINATOR, FEED, id, issue, opened, roundKey } from "../../test-tab.ts";

// A round in an issue's feed: folded to a line, the latest open, its body read only while open; and
// the criteria × rounds grid, each cell opening to that round's evidence.

afterEach(cleanup);

const WEB_1 = [issue("WEB-1", { status: "in-review", headline: "✓ Verified: Retries land" })];
const keyOf = (n: number) => roundBodyKey(COORDINATOR.id, id("WEB-1"), roundKey(n));

function rounds(tab: ReturnType<typeof within>) {
  const card = (n: number) => within(tab.getByRole("article", { name: `Round ${n}` }));
  const head = (n: number) => card(n).getByRole("button", { name: new RegExp(`^Round ${n}`) });
  const open = () => [1, 2, 3, 4].filter((n) => tab.queryByRole("article", { name: `Round ${n}` }) !== null && head(n).getAttribute("aria-expanded") === "true");
  return { card, head, open };
}

test("each round folds to its number, its summary and its score; the latest is open, and only its body is read", async () => {
  const { tab, bodyReads } = await opened("WEB-1", WEB_1);
  const { card, head, open } = rounds(tab());
  assert.deepEqual(open(), [3]);
  assert.deepEqual([1, 2, 3].map((n) => head(n).textContent), ["Round 1Round 1: retries land with backoffFailed: 1 of 3", "Round 2Round 2: retries land with backoffFailed: 2 of 3", "Round 3Round 3: retries land with backoffPassed: 3 of 3"]);
  await card(3).findByText("The backoff has no cap.");
  assert.deepEqual(bodyReads.flat(), [keyOf(3)], "a folded round reads nothing");
});

test("an open round shows its steps: the handoff and its report, the reviewer's findings each with the verifier's Confirmed or Rejected and why, a rejected claim struck, the failing criteria with their evidence and the passes folded, then where it went", async () => {
  const { tab } = await opened("WEB-1", WEB_1);
  const { card, head } = rounds(tab());
  fireEvent.click(head(1));
  const one = card(1);
  await one.findByText("The backoff has no cap.");
  assert.ok(one.getByText((_, element) => element?.classList.contains("rmi-step-title") === true && /^a1 handed off/.test(element.textContent ?? "")));
  assert.ok(one.getByText("Round 1: retries land with backoff", { selector: ".rmi-step-text" }));
  assert.ok(one.getByText(/^Report · 1 did · 1 evidence/));

  const findings = within(one.getByRole("list", { name: "Findings" })).getAllByRole("listitem");
  assert.deepEqual(
    findings.map((finding) => [finding.querySelector(".rmi-triage b")?.textContent, finding.querySelector(".rmi-triage")?.textContent, finding.querySelector(".rmi-finding-claim s")?.textContent ?? null]),
    [
      ["Confirmed", "Confirmed Seen: it grows without bound.", null],
      ["Rejected", "Rejected It matches the row.", "The padding differs from the row's."],
    ],
  );

  const failing = within(one.getByRole("list", { name: "Failing criteria" }));
  assert.deepEqual(failing.getAllByRole("listitem").map((item) => item.querySelector(".rmi-criterion-text")?.textContent), ["npm test passes", "Escape closes the card"]);
  assert.match(one.getByLabelText("Evidence for criterion 2").textContent ?? "", /1 failing: caps the backoff/);
  const passes = one.getByText("1 passed").closest("details") ?? assert.fail("no passes");
  assert.equal(passes.open, false, "the passes stay folded");
  assert.match(one.getByText(/^Sent back to/).closest("p")?.textContent ?? "", /^Sent back to a1 as fix round 1/);
});

test("a round the reader folded stays folded, and one they opened stays open, across a read that brings a new round; the new latest opens", async () => {
  const { tab, refeed } = await opened("WEB-1", WEB_1);
  const { head, open } = rounds(tab());
  fireEvent.click(head(3));
  fireEvent.click(head(1));
  assert.deepEqual(open(), [1]);

  const four = FEED.entries.flatMap((entry) => (entry.kind === "round" && entry.round.number === 3 ? [{ ...entry, round: { ...entry.round, key: roundKey(4), number: 4, at: 8_000 } }] : []));
  await refeed("WEB-1", () => ({ ...FEED, entries: [...FEED.entries, ...four] satisfies Entry[] }));
  await waitFor(() => assert.deepEqual(open(), [1, 4]));
});

test("a round the reader is reading in stays open, with their focus, when a read brings a newer round", async () => {
  const { tab, refeed } = await opened("WEB-1", WEB_1);
  const { card, open } = rounds(tab());
  const report = (await card(3).findByText(/^Report ·/)).closest("summary") ?? assert.fail("no report fold");
  report.focus();
  fireEvent.focus(report);
  const four = FEED.entries.flatMap((entry) => (entry.kind === "round" && entry.round.number === 3 ? [{ ...entry, round: { ...entry.round, key: roundKey(4), number: 4, at: 8_000 } }] : []));
  await refeed("WEB-1", () => ({ ...FEED, entries: [...FEED.entries, ...four] satisfies Entry[] }));
  await waitFor(() => assert.deepEqual(open(), [3, 4]));
  assert.equal(document.activeElement, report, "focus stays where the reader put it");
});

test("a criterion's cell opens to that round's evidence for it, read with the round's body, and closes again", async () => {
  const { tab } = await opened("WEB-1", WEB_1);
  const grid = within(tab().getByRole("heading", { name: "Done when" }).closest("section") ?? assert.fail("no Done when"));
  assert.equal(grid.getByText(/^3 rounds · latest/).textContent, "3 rounds · latest Passed: 3 of 3", "the latest round's own score, as its line says it");
  const cells = within(grid.getByRole("group", { name: "Criterion 3 by round" })).getAllByRole("button");
  assert.deepEqual(cells.map((cell) => cell.getAttribute("aria-label")), ["Round 1: failed", "Round 2: failed", "Round 3: passed"]);

  const cell = cells[1] ?? assert.fail("no round 2 cell");
  fireEvent.click(cell);
  assert.equal(cell.getAttribute("aria-expanded"), "true");
  const evidence = await grid.findByLabelText("Evidence for criterion 3 in round 2");
  const judged = bodyOf(2).verdict;
  assert.equal(evidence.textContent, judged?.state === "returned" ? judged.criteria[2]?.evidence : assert.fail("round 2 returned no verdict"));
  assert.equal(evidence.tabIndex, 0, "long evidence scrolls from the keyboard");
  fireEvent.click(cell);
  assert.equal(grid.queryByLabelText("Evidence for criterion 3 in round 2"), null);
});

test("a round whose body fails to read says so beside its steps, and Retry reads that round again", async () => {
  let fails = true;
  const { tab, bodyReads } = await opened("WEB-1", WEB_1, {
    bodies: () => {
      if (fails) throw new Error("bb is restarting");
      return bodyOf(3);
    },
  });
  const three = rounds(tab()).card(3);
  const alert = await three.findByRole("alert");
  assert.match(alert.textContent ?? "", /Could not read round 3: .*bb is restarting/);
  assert.ok(three.getByText(/^Reviewer found 2 issues/), "the steps the feed already has stay");
  fails = false;
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await three.findByText("The backoff has no cap.");
  assert.equal(three.queryByRole("alert"), null);
  assert.deepEqual(new Set(bodyReads.flat()), new Set([keyOf(3)]));
});

test("a round whose findings may or may not have reached its agent says so, and that the manager decides", async () => {
  const maybe: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 1 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, fixRound: { round: 1, delivery: "maybe" } } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: maybe }) });
  const { card, head } = rounds(tab());
  fireEvent.click(head(1));
  const outcome = (await card(1).findByText(/sent back to/)).closest("p");
  assert.match(outcome?.textContent ?? "", /^Maybe sent back to a1 as fix round 1: the regional manager decides/);
});

test("a cell shows its result by glyph, and its tooltip names it on focus and hover, until Escape, wherever focus is", async () => {
  const { tab } = await opened("WEB-1", WEB_1);
  const grid = within(tab().getByRole("heading", { name: "Done when" }).closest("section") ?? assert.fail("no Done when"));
  const cells = within(grid.getByRole("group", { name: "Criterion 3 by round" })).getAllByRole("button");
  assert.deepEqual(cells.map((cell) => cell.querySelector("svg")?.getAttribute("data-result")), ["fail", "fail", "pass"], "a cross or a check, not colour alone");

  const cell = cells[1] ?? assert.fail("no round 2 cell");
  fireEvent.focus(cell);
  const tip = grid.getByRole("tooltip");
  assert.equal(tip.textContent, "Round 2: failed. Press for its evidence.");
  assert.equal(cell.getAttribute("aria-describedby"), tip.id);
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(grid.queryByRole("tooltip"), null, "Escape closes it with focus anywhere");
  fireEvent.blur(cell);

  const slot = cells[0]?.parentElement ?? assert.fail("no slot");
  fireEvent.mouseEnter(slot);
  assert.equal(grid.getByRole("tooltip").textContent, "Round 1: failed. Press for its evidence.");
  fireEvent.mouseLeave(slot);
  assert.equal(grid.queryByRole("tooltip"), null);
});

test("a round whose passing verdict was replaced while it waited for CI says it was replaced before CI, not before its verdict", async () => {
  const replaced: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "superseded" } } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: replaced }) });
  const three = rounds(tab()).card(3);
  assert.ok(await three.findByText(/^Replaced before CI was judged/));
  assert.ok(three.getAllByText("Replaced", { selector: ".rmi-score" }).length > 0, "its score says replaced, not passed");
});

test("a round whose criteria all passed but CI failed leads its line with that reason, never a count of passes", async () => {
  const ciFailed: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "ci" } } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: ciFailed }) });
  assert.equal(rounds(tab()).head(3).textContent, "Round 3Round 3: retries land with backoffCI failed");
});

test("a final check whose own worktree was dirty says so, never that a claimed commit was missing", async () => {
  const dirty: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null
      ? { ...entry, round: { ...entry.round, by: { kind: "final", defaultBranch: "main" }, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "checkout" } } } }
      : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: dirty }) });
  assert.equal(rounds(tab()).head(3).textContent, "Round 3Final check on mainNot a clean tree");
});

test("the grid's head says the latest round's own score, so one all of whose criteria passed but CI failed reads as failed there too", async () => {
  const ciFailed: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "ci" } } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: ciFailed }) });
  const grid = within(tab().getByRole("heading", { name: "Done when" }).closest("section") ?? assert.fail("no Done when"));
  assert.equal(grid.getByText(/^3 rounds · latest/).textContent, "3 rounds · latest CI failed");
});
