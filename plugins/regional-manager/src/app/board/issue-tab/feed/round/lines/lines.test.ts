import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { handoffIdSchema } from "../../../../../../model/agent/handoff.ts";
import { bodyOf as bodyOfCheck, type RoundBody } from "../../../../../../model/feed/round.ts";
import { checkIdSchema, type Check } from "../../../../../../model/verdict/check.ts";
import { reviewSchema } from "../../../../../../model/verdict/review.ts";
import { storedVerdictSchema, withReview, type ShownVerdict } from "../../../../../../model/verdict/verdict.ts";
import { agent, bodyOf, COORDINATOR, id, issue, opened, SHA } from "../../../test-tab.ts";

// An open round's findings, a line each: its mark, labelled with its severity and what it does to
// the work, its severity, its title and its place; a card on hover and focus; its claim, the
// verifier's word and reason, a bug's steps and its full path on press. A round stored before
// findings had titles shows each by the title its claim gives it.

afterEach(cleanup);

const WEB_1 = [issue("WEB-1", { status: "in-review", headline: "✓ Verified: Retries land" })];

/** BBP-93's round 1 in short: a must-fix the verifier anchored as a bug, with its steps, and a should-fix it confirmed, which goes to the follow-up. */
const PATH = "plugins/regional-manager/src/server/verify/verifier-brief.ts";
const ANCHORED: RoundBody["findings"][number] = {
  title: "A final check re-applies a decision blocker the user has since changed",
  file: PATH,
  line: 74,
  severity: "must-fix",
  claim: "The next final prompt carries the old decision blocker.",
  origin: "new",
  triage: { result: "anchored", anchor: "bug", steps: ["Record a JSON-export decision.", "Fail its final check on it.", "Record the CSV approval."], reason: "Reproduced in the final-check harness.", effect: "blocks" },
};
const CONFIRMED: RoundBody["findings"][number] = {
  title: "\"A refusal saves nothing\" is untrue when the worktree can't be read",
  file: "plugins/regional-manager/src/server/verify/verdict-tool.ts",
  line: 184,
  severity: "should-fix",
  claim: "verify.returned saves could-not-run before issue_verdict refuses.",
  origin: "new",
  triage: { result: "confirmed", reason: "The unreadable-worktree test saves before the refusal.", effect: "follow-up" },
};
const FINDINGS = [ANCHORED, CONFIRMED];

async function openRound(findings: RoundBody["findings"], verdict: ShownVerdict | null = bodyOf(3).verdict) {
  const { tab } = await opened("WEB-1", WEB_1, { bodies: () => ({ ...bodyOf(3), verdict, findings }) });
  const round = within(tab().getByRole("article", { name: "Round 3" }));
  const list = within(await round.findByRole("list", { name: "Findings" }));
  return { round, lines: () => list.getAllByRole("button") };
}

const detailOf = (line: HTMLElement): HTMLElement => document.getElementById(line.getAttribute("aria-controls") ?? "") ?? assert.fail("no detail");

test("an opened round renders a line per finding: its severity word, its title and its place, each mark labelled with its severity and what it does", async () => {
  const { lines } = await openRound(FINDINGS);
  assert.deepEqual(
    lines().map((line) => [line.querySelector(".rmi-line-severity")?.textContent, line.querySelector(".rmi-line-title")?.textContent, line.querySelector(".rmi-line-place")?.textContent]),
    [
      ["must-fix", "A final check re-applies a decision blocker the user has since changed", "verifier-brief.ts:74"],
      ["should-fix", "\"A refusal saves nothing\" is untrue when the worktree can't be read", "verdict-tool.ts:184"],
    ],
  );
  assert.deepEqual(
    lines().map((line) => within(line).getByRole("img").getAttribute("aria-label")),
    ["must-fix: blocks the work", "should-fix: goes to the follow-up"],
  );
  assert.equal(within(lines()[0] ?? assert.fail("no line")).getByRole("img").dataset.effect, "blocks", "the mark's colour is what the finding does");
});

test("every effect has its own mark and words; a downgraded finding shows its new severity, and a rejected one says so", async () => {
  const base = { file: "src/retry.ts", line: 4, claim: "It holds.", origin: "new" } as const;
  const { lines } = await openRound([
    { ...base, title: "Downgraded", severity: "must-fix", triage: { result: "downgraded", to: "should-fix", reason: "No anchor.", effect: "follow-up" } },
    { ...base, title: "A nit", severity: "nit", triage: { result: "confirmed", reason: "Taste.", effect: "nit" } },
    { ...base, title: "Rejected", severity: "should-fix", triage: { result: "rejected", reason: "It doesn't hold.", effect: "rejected" } },
  ]);
  assert.deepEqual(
    lines().map((line) => [line.querySelector(".rmi-line-severity")?.textContent, within(line).getByRole("img").getAttribute("aria-label")]),
    [
      ["should-fix", "should-fix: goes to the follow-up"],
      ["nit", "nit: held as a nit"],
      ["should-fix", "should-fix: rejected"],
    ],
  );
});

test("a finding opens on press to its claim, the verifier's word and reason, its numbered steps and its full path, byte for byte as the reviewer wrote it", async () => {
  const odd = ` src/​retry‏‮.ts`;
  const { lines } = await openRound([{ ...ANCHORED, file: odd }, CONFIRMED]);
  const [first] = lines();
  if (first === undefined) return assert.fail("no line");
  assert.equal(detailOf(first).hidden, true, "folded until pressed");
  fireEvent.click(first);
  assert.equal(first.getAttribute("aria-expanded"), "true");
  const detail = detailOf(first);
  assert.equal(detail.hidden, false);
  assert.deepEqual(
    [...detail.children].map((part) => part.textContent),
    [
      "The next final prompt carries the old decision blocker.",
      "Anchored, as a bug hit in normal use. Reproduced in the final-check harness.",
      "Record a JSON-export decision.Fail its final check on it.Record the CSV approval.",
      `${odd}:74 · must-fix · new`,
    ],
  );
  assert.equal(within(detail).getByRole("list", { name: "Steps" }).tagName, "OL", "the steps numbered");
  assert.equal(detail.querySelector(".rmi-fold-file")?.textContent, odd, "nothing trimmed or stripped");
  fireEvent.click(first);
  assert.equal(detailOf(first).hidden, true, "pressed again, it folds");
});

test("a finding's card shows on focus its title, severity, origin, place and the verifier's word and reason, and Escape closes it wherever focus is", async () => {
  const { round, lines } = await openRound(FINDINGS);
  const [first, second] = lines();
  if (first === undefined || second === undefined) return assert.fail("no lines");
  act(() => first.focus());
  const card = round.getByRole("tooltip");
  assert.equal(first.getAttribute("aria-describedby"), card.id);
  assert.deepEqual(
    [...(card.firstElementChild?.children ?? [])].map((part) => part.textContent),
    ["A final check re-applies a decision blocker the user has since changed", "must-fix · new", `${PATH}:74`, "Anchored, as a bug hit in normal use. Reproduced in the final-check harness."],
  );
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(round.queryByRole("tooltip"), null, "Escape closes it");
  assert.equal(first.getAttribute("aria-describedby"), null);
  act(() => second.focus());
  assert.match(round.getByRole("tooltip").textContent ?? "", /^"A refusal saves nothing".*should-fix · new.*Confirmed\. The unreadable-worktree test/);
  fireEvent.click(second);
  assert.equal(round.queryByRole("tooltip"), null, "a press puts it away, as the detail opens where it sat");
});

test("the verifier's own findings follow the reviewer's, marked by what their severity does: a should-fix goes to the follow-up, a nit stays one", async () => {
  const returned = bodyOf(3).verdict;
  if (returned?.state !== "returned") return assert.fail("no returned verdict");
  const verdict: ShownVerdict = { ...returned, findings: [{ severity: "should-fix", title: "The card has no close button", detail: "Only Escape closes it." }, { severity: "nit", title: "Odd spacing", detail: "4px, not 6px." }] };
  const { lines } = await openRound([ANCHORED], verdict);
  assert.deepEqual(
    lines().map((line) => [line.querySelector(".rmi-line-title")?.textContent, within(line).getByRole("img").getAttribute("aria-label"), line.querySelector(".rmi-line-place")?.textContent ?? null]),
    [
      ["A final check re-applies a decision blocker the user has since changed", "must-fix: blocks the work", "verifier-brief.ts:74"],
      ["The card has no close button", "should-fix: goes to the follow-up", null],
      ["Odd spacing", "nit: held as a nit", null],
    ],
    "the verifier's own name no place",
  );
  fireEvent.click(lines()[1] ?? assert.fail("no line"));
  assert.deepEqual([...detailOf(lines()[1] ?? assert.fail("no line")).children].map((part) => part.textContent), ["Only Escape closes it.", "should-fix · the verifier's own"]);
});

/** A check as stored before findings had titles and origins, criteria a `shows` line and verifier findings a shape, and a bug's steps were one numbered line: parsed as the store parses it. */
function legacyCheck(): Check {
  const review = reviewSchema.parse({
    state: "reported",
    at: 3_200,
    reviewerThreadId: "thr_reviewer",
    findings: [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "The backoff has no cap. It grows without bound after the fifth try." }],
    model: { providerId: "codex", model: "gpt-5.4" },
  });
  const verdict = storedVerdictSchema.parse({
    state: "returned",
    at: 3_500,
    verifierThreadId: "thr_verifier",
    headSha: SHA,
    checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
    criteria: [{ criterion: "npm test passes", result: "fail", evidence: "1 failing: caps the backoff. More lines follow." }],
    findings: ["A should-fix: the retry log has no timestamps. Add them."],
    triage: [{ result: "anchored", anchor: "bug", steps: "1. Fail a delivery. 2. Watch the retries.", reason: "Seen in the log." }],
    mustFixFails: true,
    model: { providerId: "claude-code", model: "sonnet" },
    sameModel: false,
  });
  if (review.state !== "reported") return assert.fail("not reported");
  const subject = { kind: "handoff", agentId: agent("a2").id, handoffId: handoffIdSchema.parse("00000000-0000-4000-8000-000000000003"), headSha: SHA, prUrl: null, branch: null } as const;
  return { id: checkIdSchema.parse("00000000-0000-4000-8000-000000000301"), coordinatorId: COORDINATOR.id, issueId: id("WEB-1"), at: 5_000, criteria: ["npm test passes"], verifier: null, reviewer: null, subject, review, verdict: withReview(verdict, review.findings), followUpId: null, acceptedAt: null };
}

test("a round stored before findings had titles renders through the titles derived from its claims, its criterion through what its evidence first says", async () => {
  const body = bodyOfCheck(null, legacyCheck());
  const { tab } = await opened("WEB-1", WEB_1, { bodies: () => body });
  const round = within(tab().getByRole("article", { name: "Round 3" }));
  const findings = within(await round.findByRole("list", { name: "Findings" })).getAllByRole("button");
  assert.deepEqual(
    findings.map((line) => [line.querySelector(".rmi-line-title")?.textContent, within(line).getByRole("img").getAttribute("aria-label")]),
    [
      ["The backoff has no cap.", "must-fix: blocks the work"],
      ["A should-fix: the retry log has no timestamps.", "should-fix: goes to the follow-up"],
    ],
  );
  fireEvent.click(findings[0] ?? assert.fail("no line"));
  assert.equal(within(detailOf(findings[0] ?? assert.fail("no line"))).getByRole("list", { name: "Steps" }).textContent, "Fail a delivery.Watch the retries.", "its numbered line split into steps");
  const failed = within(round.getByRole("list", { name: "What failed" })).getAllByRole("button");
  assert.deepEqual(failed.map((line) => line.querySelector(".rmi-line-title")?.textContent), ["1 failing: caps the backoff."]);
});

/** The feed laid out as the browser would, in a window `window.innerHeight` tall: each line's box at `line` (as it is when measured, so a test moves it by changing it), a finding card's content `height` tall. why stubs: jsdom lays nothing out. */
function laidOut(line: { top: number; bottom: number }, height: number): () => void {
  const rect = (top: number, bottom: number) => DOMRect.fromRect({ x: 0, y: top, width: 549, height: bottom - top });
  const boxOf = HTMLElement.prototype.getBoundingClientRect;
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("rmi-fold-box") ? rect(line.top, line.bottom) : rect(0, 0);
  };
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get(this: HTMLElement) { return this.classList.contains("rmi-finding-card-body") ? height : 0; } });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = boxOf;
    if (scrollHeight !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
  };
}

test("a finding's card opens under its line where it fits, above it at the foot of the panel, and capped to the bigger side when it fits on neither, as a board row's card does", async () => {
  const foot = window.innerHeight;
  const cases = [
    { name: "room below", line: { top: 100, bottom: 128 }, height: 186, want: { side: "below", cap: "" } },
    { name: "the panel's foot", line: { top: foot - 70, bottom: foot - 42 }, height: 186, want: { side: "above", cap: "" } },
    { name: "room on neither side, more above", line: { top: foot - 200, bottom: foot - 172 }, height: foot, want: { side: "above", cap: `${foot - 204}px` } },
  ];
  for (const { name, line, height, want } of cases) {
    const { round, lines } = await openRound(FINDINGS);
    const restore = laidOut(line, height);
    try {
      act(() => lines()[1]?.focus());
      const card = round.getByRole("tooltip");
      assert.deepEqual({ side: card.dataset.side, cap: card.style.getPropertyValue("--rmi-card-cap") }, want, name);
    } finally {
      restore();
      cleanup();
    }
  }
});

test("what failed a round besides its findings is one row each, a checkout or CI failure opening on press to what was read; an open round's head says its verdict in a word", async () => {
  const returned = bodyOf(1).verdict;
  if (returned?.state !== "returned") return assert.fail("no returned verdict");
  const verdict: ShownVerdict = {
    ...returned,
    checkout: { headSha: "0".repeat(40), changedFiles: ["src/retry.ts"], changedFileCount: 1 },
    settlement: { kind: "checked", ci: { kind: "fail", forge: "github", number: 41, failedChecks: ["check (node 22)", "standalone-install"] } },
  };
  const { tab } = await opened("WEB-1", WEB_1, { bodies: () => ({ ...bodyOf(1), verdict }) });
  fireEvent.click(within(tab().getByRole("article", { name: "Round 1" })).getByRole("button", { name: /^Round 1/ }));
  const round = within(tab().getByRole("article", { name: "Round 1" }));
  const failed = within(await round.findByRole("list", { name: "What failed" }));
  const rows = failed.getAllByRole("listitem").map((item) => item.querySelector(".rmi-fold-row")?.textContent);
  assert.deepEqual(rows, ["Not the claimed commit on a clean tree", "Criterion 2 failed: 2Ran it.", "Criterion 3 failed: 3Ran it.", "CI failed on #41"], "each its headline alone");
  const ci = failed.getByRole("button", { name: "CI failed on #41" });
  fireEvent.click(ci);
  assert.deepEqual(within(document.getElementById(ci.getAttribute("aria-controls") ?? "") ?? assert.fail("no detail")).getAllByRole("listitem").map((check) => check.textContent), ["check (node 22)", "standalone-install"]);
  const checkout = failed.getByRole("button", { name: "Not the claimed commit on a clean tree" });
  fireEvent.click(checkout);
  assert.match(document.getElementById(checkout.getAttribute("aria-controls") ?? "")?.textContent ?? "", /src\/retry\.ts/, "opened, what bb's git plugin read");
  const score = round.getByRole("button", { name: /^Round 1/ }).querySelector(".rmi-score");
  assert.equal(score?.textContent, "Criteria failed", "open, a word: no glyph, no count");
});

test("a finding's card follows its line as the panel scrolls: above it once the line nears the panel's foot, and gone once the line can't be seen", async () => {
  const foot = window.innerHeight;
  const { round, lines } = await openRound(FINDINGS);
  const line = { top: 100, bottom: 128 };
  const restore = laidOut(line, 186);
  const panel = lines()[0]?.closest("article") ?? assert.fail("no round");
  try {
    act(() => lines()[0]?.focus());
    assert.equal(round.getByRole("tooltip").dataset.side, "below");
    Object.assign(line, { top: foot - 70, bottom: foot - 42 });
    fireEvent.scroll(panel);
    assert.equal(round.getByRole("tooltip").dataset.side, "above", "scrolled to the foot, it moves above its line");
    Object.assign(line, { top: foot + 40, bottom: foot + 68 });
    fireEvent.scroll(panel);
    assert.equal(round.queryAllByRole("tooltip").length, 0, "scrolled out of sight, it goes");
  } finally {
    restore();
  }
});
