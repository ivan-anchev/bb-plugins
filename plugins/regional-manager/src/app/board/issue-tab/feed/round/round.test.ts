import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { roundBodyKey } from "../../../../../contract.ts";
import { decisionIdSchema } from "../../../../../model/decision.ts";
import type { Entry } from "../../../../../model/feed/entry.ts";
import { bodyOf, COORDINATOR, FEED, id, issue, opened, roundKey } from "../../test-tab.ts";

// A round in an issue's feed: folded to a line, the latest open, its body read only while open and
// listed a line at a time; and the criteria × rounds grid, each cell opening to that round's
// evidence. A finding's line, its card and its detail are lines/lines.test.ts's.

afterEach(cleanup);

const WEB_1 = [issue("WEB-1", { status: "in-review", headline: "✓ Verified: Retries land" })];
const keyOf = (n: number) => roundBodyKey(COORDINATOR.id, id("WEB-1"), roundKey(n));

/**
 * Runs `body` with the feed's stylesheet in the page, so computed styles are the feed's and what CSS
 * hides drops out of accessible names. why by hand: the tests load no CSS, and jsdom computes styles
 * but lays nothing out; the live capture shows the layout.
 */
async function withFeedCss(body: () => Promise<void>) {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../feed.css", import.meta.url), "utf8");
  document.head.append(style);
  try {
    await body();
  } finally {
    style.remove();
  }
}

function rounds(tab: ReturnType<typeof within>) {
  const card = (n: number) => within(tab.getByRole("article", { name: `Round ${n}` }));
  const head = (n: number) => card(n).getByRole("button", { name: new RegExp(`^Round ${n}`) });
  const open = () => [1, 2, 3, 4].filter((n) => tab.queryByRole("article", { name: `Round ${n}` }) !== null && head(n).getAttribute("aria-expanded") === "true");
  /** A head's words without its time, which reads in the zone the tests run in. */
  const words = (n: number) => [...head(n).childNodes].filter((node) => !(node instanceof HTMLElement && node.tagName === "TIME")).map((node) => node.textContent).join("");
  return { card, head, open, words };
}

test("each round folds to its number, its summary, its score and when it was handed off; the latest is open, its score a word, and only its body is read", async () => {
  const { tab, bodyReads } = await opened("WEB-1", WEB_1);
  const { card, head, open, words } = rounds(tab());
  assert.deepEqual(open(), [3]);
  assert.deepEqual([1, 2, 3].map(words), ["Round 1Round 1: retries land with backoff2 findings, 1 heldFailed: 1 of 3", "Round 2Round 2: retries land with backoff2 findings, 1 heldFailed: 2 of 3", "Round 3Round 3: retries land with backoff2 findings, 1 heldPassed"]);
  assert.deepEqual(
    [1, 2, 3].map((n) => head(n).querySelector("time")?.dateTime),
    [3_000, 4_000, 5_000].map((at) => new Date(at).toISOString()),
    "each head ends with when its handoff came",
  );
  await card(3).findByText("The backoff has no cap.");
  assert.deepEqual(bodyReads.flat(), [keyOf(3)], "a folded round reads nothing");
});

test("an open round lists what was handed off, a line per finding, a line per criterion it failed, where it went and its report folded, with no step captions, counts or passes", async () => {
  const { tab } = await opened("WEB-1", WEB_1);
  const { card, head } = rounds(tab());
  fireEvent.click(head(1));
  const one = card(1);
  await one.findByRole("list", { name: "Findings" });
  const body = tab().getByRole("article", { name: "Round 1" }).querySelector(".rmi-round-body") ?? assert.fail("no body");
  assert.equal(one.getByText("Round 1: retries land with backoff", { selector: ".rmi-round-said" }).textContent, "Round 1: retries land with backoff");
  assert.deepEqual(
    within(one.getByRole("list", { name: "Findings" })).getAllByRole("button").map((line) => line.textContent),
    ["must-fixRetries back off without a capretry.ts:4", "nitThe retry row's padding is offretry.css"],
  );
  assert.deepEqual(
    within(one.getByRole("list", { name: "What failed" })).getAllByRole("button").map((line) => line.textContent),
    ["Criterion 2 failed: 2Ran it.", "Criterion 3 failed: 3Ran it."],
    "only the criteria it failed, each its number and what the run showed",
  );
  assert.match(one.getByText(/^Sent back to/).closest("p")?.textContent ?? "", /^Sent back to a1 as fix round 1(?!,)/);
  assert.equal(one.getByText("Report").closest("details")?.open, false, "the report is folded, named alone");
  assert.doesNotMatch(body.textContent ?? "", /Reviewer|Verifier|handed off|findings|passed|Checked/, "no step captions, counts, passes or commit");

  const criterion = within(one.getByRole("list", { name: "What failed" })).getAllByRole("button")[1] ?? assert.fail("no criterion 3");
  assert.notEqual(one.getByLabelText("Evidence for criterion 3").closest("[hidden]"), null, "folded until pressed");
  fireEvent.click(criterion);
  assert.equal(criterion.getAttribute("aria-expanded"), "true");
  assert.equal(one.getByLabelText("Evidence for criterion 3").closest("[hidden]"), null);
  assert.match(one.getByLabelText("Evidence for criterion 3").textContent ?? "", /1 failing: caps the backoff/);
  assert.ok(one.getByText("Escape closes the card", { selector: ".rmi-fold-claim" }), "opened, the criterion's words");
});

test("before its verdict returns, a round's findings show with no triage, each marked by its severity; folded, its line counts the findings and none held", async () => {
  const verifying: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.review.state === "reported"
      ? { ...entry, round: { ...entry.round, review: { ...entry.round.review, held: null, downgraded: null }, verdict: { outcome: { kind: "pending" }, results: [], fixRound: null, step: null, asked: null }, outcome: null, inFlight: true } }
      : entry,
  );
  const running = { ...bodyOf(3), verdict: { state: "running", verifierThreadId: "thr_verifier_3" }, findings: bodyOf(3).findings.map((finding) => ({ ...finding, triage: null })) } satisfies ReturnType<typeof bodyOf>;
  await withFeedCss(async () => {
    const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: verifying }), bodies: () => running });
    const { card, head } = rounds(tab());
    const findings = within(await card(3).findByRole("list", { name: "Findings" }));
    assert.deepEqual(
      findings.getAllByRole("img").map((mark) => mark.getAttribute("aria-label")),
      ["must-fix: not triaged yet", "nit: not triaged yet"],
    );
    assert.equal(findings.queryByText(/^(Confirmed|Rejected|Anchored|Downgraded)/), null, "no triage yet");
    assert.equal(card(3).queryByRole("list", { name: "What failed" }), null, "nothing judged yet");
    fireEvent.click(head(3));
    const folded = tab().getByRole("button", { name: /^Round 3 .* 2 findings Verifying… \S/ });
    assert.equal(folded.getAttribute("aria-expanded"), "false", "folded, the line counts the findings, none held yet");
  });
});

test("a review that found nothing lists no findings open, and says so on its folded line", async () => {
  const clean: Entry[] = FEED.entries.map((entry) => (entry.kind === "round" && entry.round.number === 3 ? { ...entry, round: { ...entry.round, review: { state: "reported", findings: 0, held: 0, downgraded: 0, step: { at: 5_100, moved: null } } } } : entry));
  await withFeedCss(async () => {
    const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: clean }), bodies: () => ({ ...bodyOf(3), findings: [] }) });
    const { card, head } = rounds(tab());
    await card(3).findByText("Report");
    assert.equal(card(3).queryByRole("list", { name: "Findings" }), null, "open, no findings list");
    fireEvent.click(head(3));
    assert.equal(tab().getByRole("button", { name: /^Round 3 .* No findings Passed: 3 of 3 \S/ }).getAttribute("aria-expanded"), "false");
  });
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
  const report = (await card(3).findByText("Report")).closest("summary") ?? assert.fail("no report fold");
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

test("a round whose body fails to read says so beside what the feed already shows of it, and Retry reads that round again", async () => {
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
  assert.ok(three.getByText("Round 3: retries land with backoff", { selector: ".rmi-round-said" }), "what the feed already has stays");
  fails = false;
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await three.findByText("The backoff has no cap.");
  assert.equal(three.queryByRole("alert"), null);
  assert.deepEqual(new Set(bodyReads.flat()), new Set([keyOf(3)]));
});

test("only the round whose failure asked the user at the cap says so by its score: \"3rd failed verification: asked you\"", async () => {
  const d4 = decisionIdSchema.parse("d4");
  const capped: Entry[] = FEED.entries.map((entry) => {
    if (entry.kind === "round" && entry.round.number === 2 && entry.round.verdict !== null) {
      return { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, fixRound: null, asked: d4 } } };
    }
    return entry.kind === "decision" && entry.decision.kind === "asked" && entry.decision.answer === null ? { ...entry, decision: { ...entry.decision, id: d4, cap: 3 } } : entry;
  });
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: capped }) });
  const { card, head } = rounds(tab());
  assert.deepEqual(
    [1, 2, 3].map((n) => head(n).querySelector(".rmi-score-asked")?.textContent ?? null),
    [null, "· 3rd failed verification: asked you", null],
  );
  assert.equal(head(2).querySelector(".rmi-score-asked")?.getAttribute("title"), "3rd failed verification: asked you on the board (d4)");
  fireEvent.click(head(2));
  assert.equal((await card(2).findByText(/^Not sent back/)).textContent, "Not sent back: at its cap, the plugin asked you (d4)", "the user decides, not the regional manager");
  const question = tab().getByRole("article", { name: "Question d4" });
  assert.match(question.querySelector(".rmi-decision-head")?.textContent ?? "", /^The plugin asked you/);
  assert.match(tab().getByRole("article", { name: "Question d1" }).querySelector(".rmi-decision-head")?.textContent ?? "", /^Webhook retries asked you/);
});

/** The feed with round 2's failure asking question d4 at the cap, the latest round; round 3 not yet handed off. */
function cappedAtRound2(): Entry[] {
  const d4 = decisionIdSchema.parse("d4");
  return FEED.entries.flatMap((entry): Entry[] => {
    if (entry.kind === "round" && entry.round.number === 3) return [];
    if (entry.kind === "round" && entry.round.number === 2 && entry.round.verdict !== null) {
      return [{ ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, fixRound: null, asked: d4 } } }];
    }
    return [entry.kind === "decision" && entry.decision.kind === "asked" && entry.decision.answer === null ? { ...entry, decision: { ...entry.decision, id: d4, cap: 3 } } : entry];
  });
}

test("the count of failed verifications is the asking round's head alone: the grid's head and the round's body carry none", async () => {
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: cappedAtRound2() }) });
  const { card, head } = rounds(tab());
  assert.equal(head(2).querySelector(".rmi-score-asked")?.textContent, "· 3rd failed verification: asked you");
  const grid = tab().getByRole("heading", { name: "Done when" }).closest(".rmi-section-head") ?? assert.fail("no Done when head");
  assert.doesNotMatch(grid.textContent ?? "", /asked you/);
  await card(2).findByText(/^Not sent back/);
  const body = tab().getByRole("article", { name: "Round 2" }).querySelector(".rmi-round-body") ?? assert.fail("no body");
  assert.doesNotMatch(body.textContent?.replace("the plugin asked you (d4)", "") ?? "", /failed verification/, "only its outcome says who decides");
});

test("the plugin's question at the cap takes an answer while its issue is open; once the issue is Done its options are no buttons, and it says why", async () => {
  const open = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: cappedAtRound2() }) });
  const asking = within(open.tab().getByRole("article", { name: "Question d4" }));
  assert.ok(asking.getAllByRole("button").length > 0, "open: each option answers it");
  cleanup();

  const done = await opened("WEB-1", [issue("WEB-1", { status: "done", headline: "Merged #41" })], { feedOf: () => ({ ...FEED, entries: cappedAtRound2() }) });
  const lapsed = within(done.tab().getByRole("article", { name: "Question d4" }));
  assert.deepEqual(lapsed.queryAllByRole("button"), [], "nothing to press");
  assert.ok(lapsed.getByText("Not answered: the issue is Done, so no round is left for an answer to allow."));
  assert.ok(lapsed.getByRole("list", { name: "Options" }), "its options stay, as what was asked");
});

test("focus on an option of the plugin's question at the cap moves to the question's card, never the page, when a merge closes the issue", async () => {
  const { tab, reread } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: cappedAtRound2() }) });
  const card = () => tab().getByRole("article", { name: "Question d4" });
  const option = within(card()).getByRole("button", { name: "Ship now" });
  option.focus();
  assert.equal(document.activeElement, option, "focus is on the option");

  await reread([issue("WEB-1", { status: "done", headline: "Merged #41" })]);
  await waitFor(() => assert.equal(within(card()).queryAllByRole("button").length, 0, "the issue's close took the options"));
  // why by its name: a failed comparison of two elements prints the whole DOM.
  assert.equal(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName, "Question d4");
});

test("a round whose findings may have reached its agent, and whose failure asked at the cap, says the user decides", async () => {
  const d4 = decisionIdSchema.parse("d4");
  const maybe: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 1 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, fixRound: { round: 1, delivery: "maybe" }, asked: d4 } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: maybe }) });
  const { card, head } = rounds(tab());
  fireEvent.click(head(1));
  const outcome = (await card(1).findByText(/sent back to/)).closest("p");
  assert.match(outcome?.textContent ?? "", /^Maybe sent back to a1 as fix round 1: at its cap, the plugin asked you \(d4\)/);
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
  assert.equal(rounds(tab()).words(3), "Round 3Round 3: retries land with backoff2 findings, 1 heldCI failed");
});

test("a round whose criteria all passed but whose must-fix finding the verifier anchored leads with that reason, never its score", async () => {
  const mustFix: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "must-fix" } } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: mustFix }) });
  assert.equal(rounds(tab()).words(3), "Round 3Round 3: retries land with backoff2 findings, 1 heldMust-fix upheld");
});

test("a round whose criteria all passed but whose verifier found a blocking defect of its own leads with that reason, and lists the defect as a line that opens to its claim and steps", async () => {
  const defect: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "defect" } } } } : entry,
  );
  const body = bodyOf(3);
  const blocking = { title: "cli.js crashes on an empty counts.json", claim: "It reads the file before checking it.", anchor: "bug", steps: ["Kill a run mid-save.", "Run it again."] } as const;
  const verdict = body.verdict?.state === "returned" ? { ...body.verdict, blocking: [{ ...blocking, steps: [...blocking.steps] }] } : assert.fail("no returned verdict");
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: defect }), bodies: () => ({ ...body, verdict }) });
  assert.equal(rounds(tab()).words(3), "Round 3Round 3: retries land with backoff2 findings, 1 heldBlocking defect found");
  const three = rounds(tab()).card(3);
  const failed = within(await three.findByRole("list", { name: "What failed" }));
  const line = failed.getByRole("button", { name: /cli\.js crashes/ });
  assert.equal(line.textContent, "must-fixcli.js crashes on an empty counts.json");
  assert.equal(within(line).getByRole("img").getAttribute("aria-label"), "must-fix: blocks the work");
  fireEvent.click(line);
  const detail = document.getElementById(line.getAttribute("aria-controls") ?? "") ?? assert.fail("no detail");
  assert.equal(detail.hidden, false);
  assert.deepEqual(
    [...detail.children].map((part) => part.textContent),
    ["It reads the file before checking it.", "Blocks, as a bug hit in normal use.", "Kill a run mid-save.Run it again."],
  );
});

test("a final check whose own worktree was dirty says so, never that a claimed commit was missing", async () => {
  const dirty: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null
      ? { ...entry, round: { ...entry.round, by: { kind: "final", defaultBranch: "main" }, review: { state: "none" }, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "checkout" } } } }
      : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: dirty }) });
  assert.equal(rounds(tab()).words(3), "Round 3Final check on mainNot a clean tree");
});

/** FEED with two criteria and two rounds: round 1 failed the second, and round 2, the latest, failed it again. */
function twoCriteriaTwoRounds() {
  const entries = FEED.entries.flatMap((entry): Entry[] => {
    if (entry.kind !== "round") return [entry];
    if (entry.round.number === 3 || entry.round.verdict === null) return [];
    return [{ ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "criteria" }, results: ["pass", "fail"] } } }];
  });
  return { ...FEED, doneCriteria: ["Retries land", "npm test passes"], entries };
}

test("Done when shows each criterion's mark per round, and beside its heading the latest round's marks counted, ✓ passed and ✗ failed, with nothing else", async () => {
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: twoCriteriaTwoRounds });
  const section = tab().getByRole("heading", { name: "Done when" }).closest("section") ?? assert.fail("no Done when");
  const marks = (n: number) => within(within(section).getByRole("group", { name: `Criterion ${n} by round` })).getAllByRole("button").map((cell) => [cell.getAttribute("aria-label"), cell.querySelector("svg")?.dataset.result]);
  assert.deepEqual(marks(1), [["Round 1: passed", "pass"], ["Round 2: passed", "pass"]]);
  assert.deepEqual(marks(2), [["Round 1: failed", "fail"], ["Round 2: failed", "fail"]]);
  const head = section.querySelector(".rmi-section-head") ?? assert.fail("no head");
  const tally = [...head.querySelectorAll<HTMLElement>(".rmi-tally > [data-result]")].map((count) => [count.querySelector("svg")?.dataset.result, count.textContent]);
  assert.deepEqual(tally, [["pass", "1"], ["fail", "1"]], "✓ 1 ✗ 1");
  assert.equal(head.textContent, "Done when11Round 2: 1 passed, 1 failed", "the heading and the count alone, named in words for screen readers");
});

test("before any verdict Done when shows its heading alone; a criterion the latest round couldn't check adds ⚠ to the count", async () => {
  const unjudged = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: FEED.entries.filter((entry) => entry.kind !== "round") }) });
  const head = () => unjudged.tab().getByRole("heading", { name: "Done when" }).closest(".rmi-section-head") ?? assert.fail("no head");
  assert.equal(head().textContent, "Done when");
  cleanup();
  const unchecked: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, results: ["pass", "unverifiable", "fail"] } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: unchecked }) });
  const counted = tab().getByRole("heading", { name: "Done when" }).closest(".rmi-section-head") ?? assert.fail("no head");
  assert.equal(within(counted as HTMLElement).getByText(/^Round 3:/).textContent, "Round 3: 1 passed, 1 failed, 1 couldn't check");
});

test("a round nothing verified, as with verification off, shows no findings, nothing failed and no outcome line; its score says it", async () => {
  // why this shape: with verification off a handoff gets no review and a waived verdict (server/review/review.test.ts).
  const waived: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 ? { ...entry, round: { ...entry.round, review: { state: "none" }, verdict: { outcome: { kind: "unverified" }, results: [], fixRound: null, step: null, asked: null }, inFlight: false } } : entry,
  );
  const unverified = { ...bodyOf(3), verdict: { state: "waived" }, findings: [] } satisfies ReturnType<typeof bodyOf>;
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: waived }), bodies: () => unverified });
  const three = rounds(tab()).card(3);
  await three.findByText("Report");
  assert.equal(rounds(tab()).words(3), "Round 3Round 3: retries land with backoffNot verified");
  assert.equal(three.queryAllByRole("list", { name: "Findings" }).length, 0);
  assert.equal(three.queryAllByRole("list", { name: "What failed" }).length, 0);
  assert.equal(tab().getByRole("article", { name: "Round 3" }).querySelectorAll(".rmi-outcome").length, 0, "no outcome line");
});

test("a long history keeps the criterion's words: its cells wrap, six to a line, rather than widen the row", async () => {
  const third = FEED.entries.find((entry) => entry.kind === "round" && entry.round.number === 3);
  const many: Entry[] = Array.from({ length: 16 }, (_, i) =>
    third?.kind === "round" ? { ...third, round: { ...third.round, key: roundKey(10 + i), number: 4 + i, at: 9_000 + i } } : assert.fail("no round 3"),
  );
  await withFeedCss(async () => {
    const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, ...many] }) });
    const cells = tab().getByRole("group", { name: "Criterion 1 by round" });
    assert.equal(within(cells).getAllByRole("button").length, 19);
    const { flexWrap, maxWidth } = getComputedStyle(cells);
    assert.deepEqual([flexWrap, maxWidth], ["wrap", "113px"], "six 18px cells and their 1px gaps");
  });
});

test("a missed review says it was missed, with why once the round's body is read", async () => {
  const missed: Entry[] = FEED.entries.map((entry) => (entry.kind === "round" && entry.round.number === 3 ? { ...entry, round: { ...entry.round, review: { state: "missed", step: { at: 5_100, moved: null } } } } : entry));
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: missed }), bodies: () => ({ ...bodyOf(3), findings: [], reviewMissed: "no independent reviewer model" }) });
  const three = rounds(tab()).card(3);
  const missedLine = within(three.getByRole("list", { name: "Review" })).getByRole("button", { name: "Review missed" });
  await waitFor(() => assert.equal(document.getElementById(missedLine.getAttribute("aria-controls") ?? "")?.textContent, "no independent reviewer model"));
  fireEvent.click(missedLine);
  assert.equal(missedLine.getAttribute("aria-expanded"), "true", "one row, its reason on press");
});

test("an open round whose review is still to come shows what was handed off and nothing judged yet; its score says it is reviewing", async () => {
  const reviewing: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null
      ? { ...entry, round: { ...entry.round, review: { state: "pending" }, verdict: { ...entry.round.verdict, outcome: { kind: "pending" }, results: [] }, inFlight: true } }
      : entry,
  );
  const queued = { ...bodyOf(3), verdict: { state: "queued" }, findings: [] } satisfies ReturnType<typeof bodyOf>;
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: reviewing }), bodies: () => queued });
  const three = rounds(tab()).card(3);
  await three.findByText("Report");
  assert.ok(within(rounds(tab()).head(3)).getByText("Reviewing…"));
  assert.equal(three.queryByRole("list", { name: "Findings" }), null);
  assert.equal(three.queryByRole("list", { name: "What failed" }), null);
  assert.equal(three.queryByText("Waiting for a verifier"), null);
});

test("a round that failed on its checkout leads with that reason, whole in its title though the line may cut it", async () => {
  const dirty: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "round" && entry.round.number === 3 && entry.round.verdict !== null ? { ...entry, round: { ...entry.round, verdict: { ...entry.round.verdict, outcome: { kind: "fail", by: "checkout" } } } } : entry,
  );
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: dirty }) });
  const reason = within(rounds(tab()).head(3)).getByText("Not the claimed commit on a clean tree");
  assert.equal(reason.getAttribute("title"), "Not the claimed commit on a clean tree");
});

test("a cell of a round no longer on record says so, not that it judged nothing there", async () => {
  const { tab } = await opened("WEB-1", WEB_1, { bodies: () => null });
  const grid = within(tab().getByRole("heading", { name: "Done when" }).closest("section") ?? assert.fail("no Done when"));
  fireEvent.click(within(grid.getByRole("group", { name: "Criterion 2 by round" })).getAllByRole("button")[0] ?? assert.fail("no cell"));
  assert.ok(await grid.findByText("Round 1 is no longer on record."));
  assert.equal(grid.queryByText(/judged no criterion here/), null);
});
