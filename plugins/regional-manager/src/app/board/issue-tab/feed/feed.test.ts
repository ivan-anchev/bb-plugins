import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { agentIdSchema } from "../../../../model/agent/agent.ts";
import type { Entry } from "../../../../model/feed/entry.ts";
import { COORDINATOR, FEED, issue, opened } from "../test-tab.ts";

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
    /^CI passed on #219, #219 merged/,
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
  const decided: Entry = { kind: "decision", decision: { kind: "recorded", text: "Ship it Monday.", at: 7_000 } };
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
  const failed: Entry = { kind: "thread", at: 6_500, agentId: agentIdSchema.parse("a2"), event: { kind: "failed", error: "The provider stopped responding" } };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, failed] }) });
  assert.ok(activity(tab()).texts().some((text) => /^a2 failed: The provider stopped responding/.test(text ?? "")));
});
