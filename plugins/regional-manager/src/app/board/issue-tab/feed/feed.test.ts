import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { agentIdSchema } from "../../../../model/agent/agent.ts";
import type { Entry } from "../../../../model/feed/entry.ts";
import { COORDINATOR, FEED, id, issue, opened } from "../test-tab.ts";

// An issue's Activity: every entry of its feed in order, each drawn by its kind, under a filter; and
// an open question answered from its card.

afterEach(cleanup);

const WEB_1 = [issue("WEB-1", { status: "in-review", headline: "✓ Verified: Retries land" })];

/** The Activity section: its entries, each by its own text. */
function activity(tab: ReturnType<typeof within>) {
  const section = within(tab.getByRole("heading", { name: "Activity" }).closest("section") ?? assert.fail("no Activity"));
  const items = () => section.queryAllByRole("listitem").filter((item) => item.parentElement?.classList.contains("rmi-entries"));
  return { section, items, texts: () => items().map((item) => item.textContent?.replace(/\s+/g, " ").trim()) };
}

test("every entry kind draws as its own: rounds and decisions as cards, the rest as quiet lines naming who did it, in the order they happened", async () => {
  const { view, tab } = await opened("WEB-1", WEB_1);
  const { section, items } = activity(tab());
  const lines = items().map((item) => item.querySelector(".rmi-round, .rmi-decision, .rmi-line")?.className.split(" ")[0]);
  assert.deepEqual(lines, ["rmi-line", "rmi-line", "rmi-round", "rmi-decision", "rmi-round", "rmi-decision", "rmi-line", "rmi-line", "rmi-round", "rmi-line", "rmi-line", "rmi-line", "rmi-decision"]);
  for (const text of [
    /^Regional manager filed the issue/,
    /^Regional manager started a1/,
    /^Regional manager handed the issue on from a1/,
    /^#219 CI passed, merged/,
    /^a2 ended its turn with no handoff\s*Merged; nothing left\./,
    /^Unblocked: WEB-7, the last of its dependencies, closed/,
  ]) assert.ok(section.getAllByRole("paragraph").some((line) => text.test(line.textContent ?? "")), `a line reads ${text}`);
  assert.ok(section.getByRole("article", { name: "Round 1" }));
  assert.ok(section.getByText("a1 loops: hand the issue to a fresh agent."));
  const answered = within(section.getByRole("article", { name: "Question d1" }));
  assert.ok(answered.getByText("Keep the row's facts?"));
  assert.deepEqual(answered.getAllByRole("listitem").map((option) => option.textContent), ["Keep, your answer", "Hide"], "the option the user chose, marked");
  assert.equal(answered.queryByRole("button"), null, "an answered question offers nothing to press");
  fireEvent.click(within(section.getByRole("article", { name: "Round 1" })).getByRole("button", { name: /^Round 1/ }));
  fireEvent.click(section.getAllByRole("button", { name: "Open a1's thread" })[0] ?? assert.fail("no link to a1"));
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_a1" }], "an agent named in a line opens its thread");
});

test("the filter shows All, only Rounds, or only the Discussion, each pressed as it is chosen, and the choice holds across a read", async () => {
  const { tab, refeed } = await opened("WEB-1", WEB_1);
  const { section, items } = activity(tab());
  const filter = (name: string) => within(section.getByRole("group", { name: "Show" })).getByRole("button", { name });
  const pressed = () => ["All", "Rounds", "Discussion"].filter((name) => filter(name).getAttribute("aria-pressed") === "true");
  const kinds = () => items().map((item) => (item.querySelector(".rmi-round") ? "round" : item.querySelector(".rmi-decision") ? "decision" : "line"));
  assert.deepEqual(pressed(), ["All"]);
  assert.equal(items().length, 13);

  fireEvent.click(filter("Rounds"));
  assert.deepEqual([pressed(), kinds()], [["Rounds"], ["round", "round", "round"]]);
  fireEvent.click(filter("Discussion"));
  assert.deepEqual([pressed(), kinds()], [["Discussion"], ["decision", "decision", "decision"]]);
  const decided: Entry = { kind: "decision", decision: { kind: "recorded", text: "Ship it Monday.", at: 7_000 }, moved: null };
  await refeed("WEB-1", () => ({ ...FEED, entries: [...FEED.entries, decided] }));
  await waitFor(() => assert.deepEqual([pressed(), kinds()], [["Discussion"], ["decision", "decision", "decision", "decision"]], "a read keeps the reader's filter"));
  fireEvent.click(filter("All"));
  assert.equal(items().length, 14);
});

test("an open question's options are buttons: pressing one answers it with that option's words, once", async () => {
  const { tab, answers } = await opened("WEB-1", WEB_1);
  const question = within(activity(tab()).section.getByRole("article", { name: "Question d2" }));
  assert.deepEqual(within(question.getByRole("list", { name: "Options" })).getAllByRole("button").map((button) => button.textContent), ["Ship now", "Wait a day"]);
  fireEvent.click(question.getByRole("button", { name: "Ship now" }));
  await waitFor(() => assert.deepEqual(answers, [{ coordinatorId: COORDINATOR.id, decisionId: "d2", answer: "Ship now" }]));
  assert.ok(question.getByRole("status"));
  fireEvent.click(question.getByRole("button", { name: "Wait a day" }));
  assert.equal(answers.length, 1, "one answer at a time");
});

test("once the answer lands the question shows it answered, and focus on the option pressed moves to the question's card, never the page", async () => {
  const { tab, answers, refeed } = await opened("WEB-1", WEB_1);
  const card = () => activity(tab()).section.getByRole("article", { name: "Question d2" });
  const option = within(card()).getByRole("button", { name: "Ship now" });
  option.focus();
  fireEvent.click(option);
  await waitFor(() => assert.equal(answers.length, 1));
  const answered: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "decision" && entry.decision.kind === "asked" && entry.decision.id === "d2" ? { ...entry, decision: { ...entry.decision, answer: { text: "Ship now", at: 7_000 } } } : entry,
  );
  await refeed("WEB-1", () => ({ ...FEED, entries: answered }));
  await waitFor(() => assert.match(card().textContent ?? "", /You answered/));
  assert.equal(document.activeElement, card());
});

test("an agent's thread that failed reads as its line, with bb's error", async () => {
  const failed: Entry = { kind: "thread", at: 6_500, agentId: agentIdSchema.parse("a2"), event: { kind: "failed", error: "The provider stopped responding" }, moved: null };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, failed] }) });
  assert.ok(activity(tab()).texts().some((text) => /^a2 failed: The provider stopped responding/.test(text ?? "")));
});

test("an agent that waited on a person reads as a moment past, not as waiting now", async () => {
  const asked: Entry = { kind: "thread", at: 6_600, agentId: agentIdSchema.parse("a2"), event: { kind: "needs-input", question: "Approve the push?" }, moved: null };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, asked] }) });
  assert.ok(activity(tab()).texts().some((text) => /^a2 asked a person: Approve the push\?/.test(text ?? "")));
});

test("a question answered elsewhere, on the Board or in another window, while focus is on one of its options moves focus to its card, never the page", async () => {
  const { tab, answers, refeed } = await opened("WEB-1", WEB_1);
  const card = () => activity(tab()).section.getByRole("article", { name: "Question d2" });
  const option = within(card()).getByRole("button", { name: "Wait a day" });
  option.focus();
  fireEvent.focus(option);
  const elsewhere: Entry[] = FEED.entries.map((entry) =>
    entry.kind === "decision" && entry.decision.kind === "asked" && entry.decision.id === "d2" ? { ...entry, decision: { ...entry.decision, answer: { text: "Ship now", at: 7_000 } } } : entry,
  );
  await refeed("WEB-1", () => ({ ...FEED, entries: elsewhere }));
  await waitFor(() => assert.match(card().textContent ?? "", /You answered/));
  assert.deepEqual(answers, [], "this card sent nothing");
  assert.equal(document.activeElement, card());
});

test("an entry that moved the issue shows the status it moved to, as the Board draws it; plan changes and where the log began are quiet lines; a move nothing explains is a line of its own", async () => {
  const moved = (entry: Entry): Entry => {
    if (entry.kind === "round" && entry.round.number === 3) {
      const { round } = entry;
      return { kind: "round", round: { ...round, handed: { ...round.handed, moved: "verifying" }, outcome: round.outcome === null ? null : { ...round.outcome, moved: "in-review" } } };
    }
    return entry.kind === "pr" ? { ...entry, moved: "done" } : entry;
  };
  const began: Entry = { kind: "logged", at: 900, event: { kind: "log-began" }, moved: null };
  const logged: Entry[] = [
    { kind: "logged", at: 6_400, event: { kind: "edited", fields: ["title", "criteria"] }, moved: null },
    { kind: "logged", at: 6_410, event: { kind: "dependency-added", on: id("WEB-7") }, moved: null },
    { kind: "moved", at: 6_450, status: "reviewing" },
  ];
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [began, ...FEED.entries.map(moved), ...logged] }) });
  const { section, texts } = activity(tab());
  const lines = texts();
  assert.match(lines[0] ?? "", /^Edits and status moves are kept from here; verdict times above are as announced or approximate/);
  assert.ok(lines.some((text) => /^#219 CI passed, merged ·\s+Done/.test(text ?? "")), lines.join("\n"));
  assert.ok(lines.some((text) => /^Regional manager edited title, criteria Jan/.test(text ?? "")), "an edit names its fields, and moved nothing");
  assert.ok(lines.some((text) => /^Regional manager made it depend on WEB-7/.test(text ?? "")));
  assert.ok(lines.some((text) => /^Reviewing Jan/.test(text ?? "")), "a move nothing explains: its glyph and name alone");
  const card = within(section.getByRole("article", { name: "Round 3" }));
  assert.match(card.getAllByRole("listitem")[0]?.textContent ?? "", /^a2 handed off ·\s+Verifying/);
  assert.ok(card.getByRole("img", { name: "Verifying" }), "the glyph is the Board's, labelled with its status");
  const outcome = section.getByRole("article", { name: "Round 3" }).querySelector(".rmi-outcome");
  assert.match(outcome?.textContent ?? "", /^Passed ·\s+In review/, "what became of its verdict, and the status that moved it to");
  assert.equal(section.getAllByRole("img", { name: "Done" }).length, 1);
});
