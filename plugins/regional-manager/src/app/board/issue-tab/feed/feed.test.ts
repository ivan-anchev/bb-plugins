import "../../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract } from "../../../../contract.ts";
import { agentIdSchema } from "../../../../model/agent/agent.ts";
import { decisionIdSchema } from "../../../../model/decision.ts";
import { commentIdSchema, type Comment } from "../../../../model/feed/comment.ts";
import type { Entry } from "../../../../model/feed/entry.ts";
import { HUES } from "../../../../model/profile/avatar.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import type { PrBadgeFacts, PrSnapshot } from "../../../../model/verdict/pr.ts";
import { shortTime } from "../../../ui/time.ts";
import { COORDINATOR, FEED, id, issue, MANAGER_NAME, opened, SHA } from "../test-tab.ts";

// An issue's Activity: every entry of its feed in order, each drawn by its kind, under a filter; and
// an open question answered from its card.

afterEach(() => {
  cleanup();
  // why: the composer keeps its draft in the browser, by issue.
  localStorage.clear();
});

/** When FEED's moments happened, as a row shows it: all of them fall in the epoch's first minute. */
const EARLY = shortTime(1_000);

const WEB_1 = [issue("WEB-1", { status: "in-review", headline: "✓ Verified: Retries land" })];

/** The Activity section: its entries, each by its own text, and its quiet rows'. */
function activity(tab: ReturnType<typeof within>) {
  const element: HTMLElement = tab.getByRole("heading", { name: "Activity" }).closest("section") ?? assert.fail("no Activity");
  const section = within(element);
  const items = () => section.queryAllByRole("listitem").filter((item) => item.parentElement?.classList.contains("rmi-entries"));
  const lines = () => [...element.querySelectorAll<HTMLElement>(".rmi-line")];
  return { section, items, lines, texts: () => items().map(spoken), rows: () => lines().map(spoken) };
}

/** An element's words and times, as read aloud. */
const spoken = (element: HTMLElement) => element.textContent?.replace(/\s+/g, " ").trim();

/** The options a question's card marks as the user's answer, each by its words. */
function marked(card: HTMLElement): string[] {
  return within(card)
    .queryAllByRole("listitem")
    .flatMap((option) => /^(.+), your answer, \S/.exec(option.textContent ?? "")?.slice(1, 2) ?? []);
}

test("every entry kind draws as its own: rounds and decisions as cards, the rest as rows of words and a time, in the order they happened", async () => {
  const { view, tab } = await opened("WEB-1", WEB_1);
  const { section, items, rows } = activity(tab());
  const lines = items().map((item) => item.querySelector(".rmi-round, .rmi-decision, .rmi-line")?.className.split(" ")[0]);
  assert.deepEqual(lines, ["rmi-line", "rmi-line", "rmi-round", "rmi-decision", "rmi-round", "rmi-decision", "rmi-line", "rmi-line", "rmi-round", "rmi-line", "rmi-line", "rmi-line", "rmi-decision"]);
  assert.deepEqual(rows(), [
    `Filed ${EARLY}`,
    `Started a1 ${EARLY}`,
    `Handed the issue on from a1 ${EARLY}`,
    `Started a2 ${EARLY}`,
    `219 CI passed, merged ${EARLY}`,
    `a2 ended its turn with no handoff: Merged; nothing left. ${EARLY}`,
    `Unblocked: WEB-7, the last of its dependencies, closed ${EARLY}`,
  ]);
  assert.ok(section.getByRole("article", { name: "Round 1" }));
  assert.ok(section.getByText("a1 loops: hand the issue to a fresh agent."));
  const answered = within(section.getByRole("article", { name: "Question d1" }));
  assert.ok(answered.getByText("Keep the row's facts?"));
  assert.deepEqual(marked(section.getByRole("article", { name: "Question d1" })), ["Keep"], "the option the user chose, marked");
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
  const options = within(question.getByRole("list", { name: "Options" }));
  assert.deepEqual(["Ship now", "Wait a day"].map((name) => options.getByRole("button", { name }).getAttribute("aria-keyshortcuts")), ["1", "2"], "a button per option, pressed by its number");
  assert.equal(options.getAllByRole("button").length, 2, "nothing else to press until the user types");
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
  await waitFor(() => assert.deepEqual(marked(card()), ["Ship now"]));
  assert.equal(document.activeElement, card());
});

/** FEED with a question d9 asking "How many retries?" with these options, answered with `answer`. */
function answeredWith(options: string[], answer: string) {
  const asked: Entry = { kind: "decision", decision: { kind: "asked", id: decisionIdSchema.parse("d9"), question: "How many retries?", options, recommended: null, at: 6_400, answer: { text: answer, at: 6_500 }, cap: null } };
  return { feedOf: () => ({ ...FEED, entries: [...FEED.entries, asked] }) };
}

/** How many times `text` appears in a card, its words for assistive tech included. */
const timesIn = (card: HTMLElement, text: string): number => (card.textContent ?? "").split(text).length - 1;

test("a question answered with one of its options shows that option marked, with when on hover, and the answer nowhere else", async () => {
  const { tab } = await opened("WEB-1", WEB_1, answeredWith(["Three", "Five"], "Five"));
  const card = activity(tab()).section.getByRole("article", { name: "Question d9" });
  assert.deepEqual(marked(card), ["Five"]);
  assert.match(within(card).getByTitle(/^Your answer, \S/).textContent ?? "", /^Five, your answer/, "when they answered, on the chosen option's hover");
  assert.equal(timesIn(card, "Five"), 1, "the answer shows once, as its option");
  assert.doesNotMatch(card.textContent ?? "", /You answered/);
});

test("a question answered in the user's own words shows its options unmarked, then the answer once, under You answered", async () => {
  const { tab } = await opened("WEB-1", WEB_1, answeredWith(["Three", "Five"], "Seven, with backoff"));
  const card = activity(tab()).section.getByRole("article", { name: "Question d9" });
  assert.deepEqual(marked(card), []);
  assert.deepEqual(within(card).getAllByRole("listitem").map((option) => option.textContent), ["Three", "Five"]);
  assert.equal(timesIn(card, "Seven, with backoff"), 1);
  assert.match(card.textContent ?? "", /You answered .+Seven, with backoff$/);
});

test("a question with no options, answered, shows the answer once, under You answered", async () => {
  const { tab } = await opened("WEB-1", WEB_1, answeredWith([], "Seven, with backoff"));
  const card = activity(tab()).section.getByRole("article", { name: "Question d9" });
  assert.equal(within(card).queryByRole("list"), null);
  assert.equal(timesIn(card, "Seven, with backoff"), 1);
  assert.match(card.textContent ?? "", /You answered .+Seven, with backoff$/);
});

test("an agent's thread that failed reads as its line, with bb's error", async () => {
  const failed: Entry = { kind: "thread", at: 6_500, agentId: agentIdSchema.parse("a2"), event: { kind: "failed", error: "The provider stopped responding" } };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, failed] }) });
  assert.ok(activity(tab()).rows().includes(`a2 failed: The provider stopped responding ${EARLY}`));
});

test("an agent that waited on a person reads as a moment past, not as waiting now", async () => {
  const asked: Entry = { kind: "thread", at: 6_600, agentId: agentIdSchema.parse("a2"), event: { kind: "needs-input", question: "Approve the push?" } };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, asked] }) });
  assert.ok(activity(tab()).rows().includes(`a2 asked a person: Approve the push? ${EARLY}`));
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
  await waitFor(() => assert.deepEqual(marked(card()), ["Ship now"]));
  assert.deepEqual(answers, [], "this card sent nothing");
  assert.equal(document.activeElement, card());
});

test("a row says what happened and when, never the status it moved the issue to: plan changes and where the log began are rows of words, a move nothing explains reads Moved to, and no row says a status twice", async () => {
  const began: Entry = { kind: "logged", at: 900, event: { kind: "log-began" } };
  const logged: Entry[] = [
    { kind: "logged", at: 6_400, event: { kind: "edited", fields: ["title", "criteria"] } },
    { kind: "logged", at: 6_410, event: { kind: "dependency-added", on: id("WEB-7") } },
    { kind: "logged", at: 6_420, event: { kind: "rested", rest: "backlog" } },
    { kind: "logged", at: 6_430, event: { kind: "accepted" } },
    { kind: "moved", at: 6_450, status: "reviewing" },
  ];
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [began, ...FEED.entries, ...logged] }) });
  const { lines: rowElements, rows } = activity(tab());
  const lines = rows();
  assert.deepEqual(lines.slice(0, 1), [`Edits and status moves are kept from here; verdict times above are as announced or approximate ${EARLY}`]);
  assert.deepEqual(lines.slice(-5), [
    `Edited title, criteria ${EARLY}`,
    `Now depends on WEB-7 ${EARLY}`,
    `Set to rest in Backlog ${EARLY}`,
    `Accepted as it is, into In review ${EARLY}`,
    `Moved to Reviewing ${EARLY}`,
  ]);
  for (const line of rowElements()) {
    // why those two allowed: the pull request's badge and an agent's link draw their own glyph, part of what they open.
    const icons = [...line.querySelectorAll("svg, img")].filter((icon) => icon.closest(".rmi-pr, .rmi-thread-link") === null).map((icon) => icon.outerHTML);
    assert.deepEqual(icons, [], `no status glyph or icon, hidden from assistive tech or not, on "${line.textContent}"`);
    for (const label of Object.values(STATUS_LABELS)) assert.ok((line.textContent ?? "").split(label).length <= 2, `"${line.textContent}" says ${label} once at most`);
  }
});

test("no row names who did it: the manager, the user or the verifier is never its first word, and none carries an avatar", async () => {
  const entries: Entry[] = [
    ...FEED.entries,
    { kind: "agent-ended", at: 6_500, agentId: agentIdSchema.parse("a2"), how: "stopped" },
    { kind: "logged", at: 6_600, event: { kind: "closed", as: "canceled" } },
    { kind: "logged", at: 6_700, event: { kind: "reopened" } },
    { kind: "logged", at: 6_800, event: { kind: "parent-set", parentId: id("WEB-2") } },
  ];
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries }) });
  const { section, lines, rows } = activity(tab());
  assert.deepEqual(rows().slice(-4), [`Stopped a2 ${EARLY}`, `Canceled ${EARLY}`, `Reopened ${EARLY}`, `Parent set to WEB-2 ${EARLY}`]);
  for (const line of rows()) assert.doesNotMatch(line ?? "", new RegExp(`^(${MANAGER_NAME}|Regional manager|The plugin|You|Verifier)\\b`));
  assert.equal(lines().filter((line) => line.querySelector(".rmi-manager") !== null).length, 0, "no avatar");
  const head = (card: string) => section.getByRole("article", { name: card }).querySelector(".rmi-decision-head")?.textContent;
  assert.equal(head("Decision"), `${MANAGER_NAME} decided ${EARLY}`, "a card keeps its author, and only its time after it");
  assert.equal(head("Question d1"), `${MANAGER_NAME} asked you ${EARLY}`, "a question's head names no status and no id");
});

test("a pull request's row leads with its badge as that moment found it, linking to it, whatever the pull request is now", async () => {
  const opened219: PrBadgeFacts = { forge: "github", number: 219, url: "https://github.com/acme/webhooks/pull/219", state: "open", draft: false, ci: "pending", failedChecks: [] };
  const rows: Entry[] = [
    { kind: "pr", at: 6_000, pr: opened219, changes: ["opened"] },
    { kind: "pr", at: 6_100, pr: { ...opened219, state: "merged", ci: "pass" }, changes: ["ci-passed", "merged"] },
  ];
  const now: PrSnapshot = { forge: "github", number: 220, url: "https://github.com/acme/webhooks/pull/220", state: "open", draft: false, review: "none", ci: "none", headSha: SHA, failedChecks: [] };
  const { tab } = await opened("WEB-1", [issue("WEB-1", { status: "reviewing", pr: now })], { feedOf: () => ({ ...FEED, entries: rows }) });
  const [open, merged] = activity(tab()).lines();
  const badge = (line: HTMLElement | undefined) => within(line ?? assert.fail("no row")).getByRole("link");
  assert.deepEqual([badge(open).getAttribute("aria-label"), badge(open).dataset.state, badge(open).getAttribute("href")], ["Pull request 219, open, CI running", "open", opened219.url]);
  assert.deepEqual([badge(merged).getAttribute("aria-label"), badge(merged).dataset.state], ["Pull request 219, merged, CI passing", "merged"]);
  assert.deepEqual(activity(tab()).rows(), [`219 opened ${EARLY}`, `219 CI passed, merged ${EARLY}`]);
});

/** What the tab posted, without each post's submission, which the browser makes up. */
const postedOf = (comments: readonly unknown[]) => comments.map((input) => coordinatorContract.commentIssue.input.omit({ submission: true }).parse(input));
/** The submission each post was sent with. */
const submissionsOf = (comments: readonly unknown[]) => comments.map((input) => coordinatorContract.commentIssue.input.parse(input).submission);

const comment = (n: number, at: number, author: Comment["author"], text: string, replyTo: number | null): Entry => ({
  kind: "comment",
  comment: { id: commentIdSchema.parse(`m${n}`), issueId: id("WEB-1"), at, text, replyTo: replyTo === null ? null : commentIdSchema.parse(`m${replyTo}`), author },
});
const COMMENTED = { ...FEED, entries: [...FEED.entries, comment(1, 6_400, { kind: "user" }, "Cap retries at five.\nAnd log each.", null), comment(2, 6_500, { kind: "manager" }, "Capped at five.", 1), comment(3, 6_600, { kind: "agent", agentId: agentIdSchema.parse("a2") }, "Done in retry.ts.", 1)] };

/**
 * Runs `body` with every cut-able text in the feed running past its lines while shut, as long words
 * do in a narrow tab. why by hand: jsdom lays nothing out, so nothing in it ever runs over.
 */
async function withLongText(body: () => Promise<void>) {
  const cut = (element: HTMLElement) => element.classList.contains("rmi-clamp") && element.dataset.open === undefined;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: function (this: HTMLElement) { return cut(this) ? 54 : 18; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 18 });
  try {
    await body();
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  }
}

/** A cut text's control: whether it is open, and how many lines it is cut to while shut. */
function cutText(button: HTMLElement) {
  const text = button.querySelector<HTMLElement>(".rmi-clamp") ?? assert.fail("no text in the button");
  return { open: button.getAttribute("aria-expanded"), lines: text.style.getPropertyValue("--rmi-lines"), drawnWhole: text.dataset.open !== undefined };
}

test("a decision shows its first sentence whole and the rest cut to two lines, a comment cut to three and a row to one; each opens on press and closes on another", async () => {
  const decided: Entry = { kind: "decision", decision: { kind: "recorded", text: "Cap retries\nat five. Each retry waits twice as long as the one before.\nThe fifth gives up and tells on-call.", at: 6_400 } };
  const said = comment(1, 6_500, { kind: "user" }, "Cap retries at five.\nAnd log each.\nAnd alert on-call.\nAnd page me.", null);
  await withLongText(async () => {
    const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, decided, said] }) });
    const { section, lines } = activity(tab());
    const [loops, capped] = section.getAllByRole("article", { name: "Decision" }).map((card) => within(card));
    assert.equal(loops?.queryByRole("button"), null, "a one-sentence decision has nothing more to open");
    assert.equal(capped?.getByText((_, element) => element?.textContent === "Cap retries\nat five.").tagName, "P", "the first sentence whole, a line break in it included");
    const rest = capped?.getByRole("button", { name: /^Each retry waits twice as long as the one before\.\s+The fifth gives up and tells on-call\.$/ }) ?? assert.fail("no rest");
    assert.deepEqual(cutText(rest), { open: "false", lines: "2", drawnWhole: false });
    fireEvent.click(rest);
    assert.deepEqual(cutText(rest), { open: "true", lines: "2", drawnWhole: true });
    fireEvent.click(rest);
    assert.deepEqual(cutText(rest), { open: "false", lines: "2", drawnWhole: false });

    const text = within(section.getByRole("article", { name: "Comment m1" })).getByRole("button", { name: /^Cap retries at five\./ });
    assert.deepEqual(cutText(text), { open: "false", lines: "3", drawnWhole: false });
    fireEvent.click(text);
    assert.deepEqual(cutText(text), { open: "true", lines: "3", drawnWhole: true });

    const row = lines().find((line) => /ended its turn/.test(line.textContent ?? "")) ?? assert.fail("no row");
    const quote = within(row).getByRole("button", { name: "Merged; nothing left." });
    assert.deepEqual(cutText(quote), { open: "false", lines: "1", drawnWhole: false });
    fireEvent.click(quote);
    assert.deepEqual(cutText(quote), { open: "true", lines: "1", drawnWhole: true });
  });
});

test("a decision whose first sentence ends in a closing quote shows that sentence alone as its headline, and the rest cut behind its press", async () => {
  const first = "“Use the read-only default.”";
  const rest = "The sandbox writes nowhere else. Every tool that needs more asks first.\nThe manager records each exception.";
  const quoted: Entry = { kind: "decision", decision: { kind: "recorded", text: `${first}\n${rest}`, at: 6_400 } };
  await withLongText(async () => {
    const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [...FEED.entries, quoted] }) });
    const card = within(activity(tab()).section.getAllByRole("article", { name: "Decision" }).at(-1) ?? assert.fail("no decision"));
    assert.equal(card.getAllByRole("paragraph")[1]?.textContent, first, "the first sentence, its closing quote included, and no more");
    const press = card.getByRole("button", { name: /^The sandbox writes nowhere else\./ });
    assert.equal(press.textContent, rest);
    assert.deepEqual(cutText(press), { open: "false", lines: "2", drawnWhole: false });
    fireEvent.click(press);
    assert.deepEqual(cutText(press), { open: "true", lines: "2", drawnWhole: true });
  });
});

test("text that fits its lines is plain text, with nothing to press", async () => {
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => COMMENTED });
  const { section, lines } = activity(tab());
  assert.equal(within(section.getByRole("article", { name: "Comment m1" })).queryByRole("button"), null);
  assert.deepEqual(lines().flatMap((line) => within(line).queryAllByRole("button").map((button) => button.textContent)), ["a1", "a1", "a2", "a2"], "only the agents named, which open their threads");
});

/** The comment field at the foot of Activity, and its form's controls. */
function composer(tab: ReturnType<typeof within>) {
  const form = within(tab.getByRole("form", { name: "Comment on WEB-1" }));
  return { form, field: form.getByRole("textbox", { name: "Comment on WEB-1" }) as HTMLTextAreaElement, send: form.getByRole("button", { name: "Comment" }) };
}

test("comments are cards in Activity and the Discussion: the user's says where it went, and a reply names and quotes what it answers", async () => {
  const { tab, view } = await opened("WEB-1", WEB_1, { feedOf: () => COMMENTED });
  const { section } = activity(tab());
  const card = (n: number) => within(section.getByRole("article", { name: `Comment m${n}` }));
  assert.match(card(1).getAllByRole("paragraph")[0]?.textContent ?? "", /^You commented/);
  assert.ok(card(1).getByText(`Sent to ${MANAGER_NAME}`), "the user's comment says where it went");
  assert.match(card(2).getAllByRole("paragraph")[0]?.textContent ?? "", /^Webhook retries replied to m1/);
  assert.equal(card(2).getByText("Cap retries at five.").className, "rmi-comment-quote", "a reply quotes the first line of what it answers");
  assert.equal(card(2).queryByText(/And log each/), null, "and no more of it");
  assert.equal(card(2).queryByText(/^Sent to/), null, "only the user's own comments say where they went");
  fireEvent.click(card(3).getByRole("button", { name: "Open a2's thread" }));
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_a2" }], "an agent's reply names it, opening its thread");
  fireEvent.click(within(section.getByRole("group", { name: "Show" })).getByRole("button", { name: "Discussion" }));
  assert.deepEqual(section.getAllByRole("article").map((article) => article.getAttribute("aria-label")), ["Question d1", "Decision", "Question d2", "Comment m1", "Comment m2", "Comment m3"]);
});

/** Who the head of comment m2, the manager's reply, names: by its avatar, as the hue it is drawn in (null: none), and by the name beside it. */
async function managerReplyByline(options: { managerListed: boolean }) {
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => COMMENTED, ...options });
  const head = within(activity(tab()).section.getByRole("article", { name: "Comment m2" })).getAllByRole("paragraph")[0] ?? assert.fail("no head");
  const hue = HUES[COORDINATOR.avatar.hue];
  return { avatar: head.querySelector(`svg [fill="${hue}"]`) === null ? null : hue, text: head.textContent };
}

test("the manager's reply names it as its own thread does: by its avatar and its name", async () => {
  const { avatar, text } = await managerReplyByline({ managerListed: true });
  assert.equal(avatar, "#895df3", "its purple avatar");
  assert.match(text ?? "", /^Webhook retries replied to m1/);
});

test("while bb lists the manager's thread no more, its reply names it by its role, with no avatar", async () => {
  const { avatar, text } = await managerReplyByline({ managerListed: false });
  assert.equal(avatar, null);
  assert.match(text ?? "", /^Regional manager replied to m1/);
});

test("⌘↵ or Ctrl+↵ sends the comment and Enter breaks the line; the field keeps focus, empties once the server took it, and its card says Sending…, then Sent, until the feed reads it", async () => {
  const releases: Array<() => void> = [];
  const { tab, comments, refeed } = await opened("WEB-1", WEB_1, { comment: () => new Promise((resolve) => releases.push(() => resolve({ commentId: `m${releases.length}` }))) });
  const { field } = composer(tab());
  field.focus();
  fireEvent.change(field, { target: { value: "Cap retries at five." } });
  assert.equal(fireEvent.keyDown(field, { key: "Enter" }), true, "Enter alone is left to the browser, which breaks the line");
  assert.deepEqual(comments, [], "and sends nothing");
  // As the browser leaves the field once it broke the line and the user typed on.
  fireEvent.change(field, { target: { value: "Cap retries at five.\nAnd log each." } });

  assert.equal(fireEvent.keyDown(field, { key: "Enter", metaKey: true }), false, "⌘↵ is the composer's, never a line break");
  await waitFor(() => assert.deepEqual(postedOf(comments), [{ coordinatorId: COORDINATOR.id, issueId: "WEB-1", text: "Cap retries at five.\nAnd log each.", replyTo: null }]));
  const sending = () => activity(tab()).section.queryByRole("article", { name: "Your comment" });
  assert.equal(within(sending() ?? assert.fail("no card")).getByRole("status").textContent, "Sending…");
  assert.equal(field.readOnly, true, "read-only, never disabled, while it sends");
  assert.equal(document.activeElement, field);
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  assert.equal(comments.length, 1, "one comment at a time");

  await act(async () => releases[0]?.());
  await waitFor(() => assert.equal(composer(tab()).field.value, ""));
  assert.equal(within(sending() ?? assert.fail("no card")).getByRole("status").textContent, "Sent as m1");
  assert.equal(document.activeElement, composer(tab()).field, "focus stays in the field");
  await refeed("WEB-1", () => ({ ...FEED, entries: [...FEED.entries, comment(1, 6_400, { kind: "user" }, "Cap retries at five.\nAnd log each.", null)] }));
  await waitFor(() => assert.equal(sending(), null, "the feed's card takes over"));
  assert.ok(activity(tab()).section.getByRole("article", { name: "Comment m1" }));

  fireEvent.change(composer(tab()).field, { target: { value: "Also alert on-call." } });
  assert.equal(fireEvent.keyDown(composer(tab()).field, { key: "Enter", ctrlKey: true }), false, "Ctrl+↵ is the composer's too");
  await waitFor(() => assert.deepEqual(postedOf(comments).at(-1), { coordinatorId: COORDINATOR.id, issueId: "WEB-1", text: "Also alert on-call.", replyTo: null }));
  assert.equal(comments.length, 2);
  assert.notEqual(submissionsOf(comments)[1], submissionsOf(comments)[0], "a new comment is a new submission");
  await act(async () => releases[1]?.());
  await waitFor(() => assert.equal(composer(tab()).field.value, ""));
});

test("a draft the browser kept fills the field, and a send that fails keeps it, beside its error", async () => {
  // As a reload finds it: the draft typed before, kept in the browser by issue.
  localStorage.setItem(`coordinator-issue-comment:${COORDINATOR.id}:WEB-1`, JSON.stringify("Cap retries at five."));
  const { tab, comments } = await opened("WEB-1", WEB_1, {
    comment: () => {
      throw new Error("bb is unreachable");
    },
  });
  assert.equal(composer(tab()).field.value, "Cap retries at five.");
  fireEvent.click(composer(tab()).send);
  await waitFor(() => assert.match(composer(tab()).form.getByRole("alert").textContent ?? "", /^Could not post your comment: .*bb is unreachable/));
  assert.equal(comments.length, 1);
  assert.equal(composer(tab()).field.value, "Cap retries at five.", "the draft stays to send again");
});

test("a send the server takes drops only the draft it sent: one typed since, after a remount, stays", async () => {
  const key = `coordinator-issue-comment:${COORDINATOR.id}:WEB-1`;
  localStorage.setItem(key, JSON.stringify("Cap retries at five."));
  let release: () => void = () => {};
  const first = await opened("WEB-1", WEB_1, { comment: () => new Promise((resolve) => (release = () => resolve({ commentId: "m1" }))) });
  fireEvent.click(composer(first.tab()).send);
  await waitFor(() => assert.equal(first.comments.length, 1));
  first.view.unmount();

  // As the remounted tab finds it once the user typed another draft there.
  localStorage.setItem(key, JSON.stringify("A different draft."));
  const second = await opened("WEB-1", WEB_1);
  assert.equal(composer(second.tab()).field.value, "A different draft.");
  await act(async () => release());

  assert.equal(localStorage.getItem(key), JSON.stringify("A different draft."), "the newer draft is kept");
  assert.equal(composer(second.tab()).field.value, "A different draft.");
});

test("a comment on its way stays on its way across a remount: the remounted field is read-only with its card, and sending again posts nothing more", async () => {
  const key = `coordinator-issue-comment:${COORDINATOR.id}:WEB-1`;
  localStorage.setItem(key, JSON.stringify("Same pending draft."));
  let release: () => void = () => {};
  const first = await opened("WEB-1", WEB_1, { comment: () => new Promise((resolve) => (release = () => resolve({ commentId: "m1" }))) });
  fireEvent.click(composer(first.tab()).send);
  await waitFor(() => assert.equal(first.comments.length, 1));
  first.view.unmount();

  const second = await opened("WEB-1", WEB_1, { comment: () => assert.fail("the draft on its way was sent again") });
  const { field, send } = composer(second.tab());
  assert.equal(field.value, "Same pending draft.");
  assert.equal(field.readOnly, true, "still sending");
  assert.equal(within(activity(second.tab()).section.getByRole("article", { name: "Your comment" })).getByRole("status").textContent, "Sending…");
  fireEvent.click(send);
  fireEvent.keyDown(field, { key: "Enter", metaKey: true });
  assert.deepEqual(second.comments, [], "nothing more is posted");

  await act(async () => release());
  await waitFor(() => assert.equal(composer(second.tab()).field.value, ""));
  assert.equal(within(activity(second.tab()).section.getByRole("article", { name: "Your comment" })).getByRole("status").textContent, "Sent as m1");
});

test("a send that fails after a remount shows its error beside the kept draft in the remounted field, which sends it again as the same submission", async () => {
  const key = `coordinator-issue-comment:${COORDINATOR.id}:WEB-1`;
  localStorage.setItem(key, JSON.stringify("Draft that fails."));
  let reject: () => void = () => {};
  const first = await opened("WEB-1", WEB_1, { comment: () => new Promise((_, fail) => (reject = () => fail(new Error("bb is unreachable")))) });
  fireEvent.click(composer(first.tab()).send);
  await waitFor(() => assert.equal(first.comments.length, 1));
  first.view.unmount();

  const second = await opened("WEB-1", WEB_1);
  await act(async () => reject());
  const { form, field, send } = composer(second.tab());
  await waitFor(() => assert.match(form.getByRole("alert").textContent ?? "", /^Could not post your comment: .*bb is unreachable/));
  assert.equal(field.value, "Draft that fails.", "the draft stays to send again");
  assert.equal(field.readOnly, false);
  assert.equal(activity(second.tab()).section.queryByRole("article", { name: "Your comment" }), null, "no card for a comment that never arrived");
  fireEvent.click(send);
  await waitFor(() => assert.deepEqual(postedOf(second.comments), [{ coordinatorId: COORDINATOR.id, issueId: "WEB-1", text: "Draft that fails.", replyTo: null }]));
  assert.deepEqual(submissionsOf(second.comments), submissionsOf(first.comments), "the server can tell the retry from a new comment, in case the first was taken and only its answer lost");
});

test("the submission is kept with the text until the server takes it: a retry of the same text reuses it, an edited text and a later comment get new ones", async () => {
  const key = `coordinator-issue-comment:${COORDINATOR.id}:WEB-1`;
  const answers: Array<() => unknown> = [
    () => {
      throw new Error("bb is unreachable");
    },
    () => {
      throw new Error("bb is unreachable");
    },
    () => ({ commentId: "m1" }),
    () => ({ commentId: "m2" }),
  ];
  const { tab, comments } = await opened("WEB-1", WEB_1, { comment: () => (answers.shift() ?? assert.fail("one post too many"))() });
  const sendText = async (text: string, alert: boolean) => {
    fireEvent.change(composer(tab()).field, { target: { value: text } });
    const before = comments.length;
    fireEvent.click(composer(tab()).send);
    await waitFor(() => assert.equal(comments.length, before + 1));
    await waitFor(() => assert.equal(composer(tab()).form.queryByRole("alert") !== null, alert));
  };
  await sendText("Cap at five.", true);
  await sendText("Cap at five, please.", true);
  await sendText("Cap at five, please.", false);
  assert.equal(localStorage.getItem(`${key}:submission`), null, "dropped once the server took it");
  await sendText("Cap at five, please.", false);
  const [first, edited, retried, again] = submissionsOf(comments);
  assert.notEqual(edited, first, "an edited text is another comment");
  assert.equal(retried, edited, "the same text sent again after a failure is the same submission");
  assert.notEqual(again, retried, "the same words posted again once taken are a new comment");
});

test("a pass that filed a follow-up draws as a row naming it", async () => {
  const followUp: Entry = { kind: "follow-up", at: Date.UTC(2026, 10, 26, 9, 34), issueId: id("WEB-9"), when: "passed" };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [followUp] }) });
  const { texts } = activity(tab());
  assert.equal(texts().length, 1);
  assert.equal(texts()[0], `Follow-up WEB-9 filed in Backlog, with the review findings that held without blocking it ${shortTime(followUp.at)}`);
});

test("a follow-up's feed begins with a row saying it was filed as the follow-up of its origin", async () => {
  const created: Entry = { kind: "created", at: Date.UTC(2026, 10, 26, 9, 34), followUpOf: { issueId: id("WEB-1"), when: "passed" } };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [created] }) });
  assert.equal(activity(tab()).texts()[0], `Filed as the follow-up of WEB-1, when it passed ${shortTime(created.at)}`);
});

test("the brief folds under the description, closed until the reader opens it, showing the text whole, a long one included", async () => {
  const brief = `- Round 1: \`notes.txt:1\` (must-fix): ${"A claim the reviewer wrote at length. ".repeat(48)}\n  The verifier: Downgraded to should-fix. ${"Its reason, in many words. ".repeat(14)}`;
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, brief }) });
  const fold = tab().getByText("Brief").closest("details") ?? assert.fail("no Brief fold");
  assert.equal(fold.open, false, "folded at first");
  fireEvent.click(within(fold).getByText("Brief"));
  assert.equal(fold.open, true);
  assert.equal(fold.querySelector("p")?.textContent, brief, "the whole brief, as written");
});

test("an issue with no brief yet draws no Brief fold", async () => {
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, brief: null }) });
  assert.equal(tab().queryAllByText("Brief").length, 0);
});

test("an accept draws as a row, and its follow-up as a row naming the findings it was accepted with", async () => {
  const at = Date.UTC(2026, 10, 26, 9, 34);
  const entries: Entry[] = [
    { kind: "logged", at, event: { kind: "accepted" } },
    { kind: "follow-up", at, issueId: id("WEB-9"), when: "accepted" },
  ];
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries }) });
  const [accept, followUp] = activity(tab()).texts();
  assert.equal(accept, `Accepted as it is, into In review ${shortTime(at)}`);
  assert.match(followUp ?? "", /^Follow-up WEB-9 filed in Backlog, with the review findings it was accepted with, its unfixed must-fixes among them/);
});

test("a follow-up filed on its origin's accept begins its feed saying so", async () => {
  const created: Entry = { kind: "created", at: Date.UTC(2026, 10, 26, 9, 34), followUpOf: { issueId: id("WEB-1"), when: "accepted" } };
  const { tab } = await opened("WEB-1", WEB_1, { feedOf: () => ({ ...FEED, entries: [created] }) });
  assert.equal(activity(tab()).texts()[0], `Filed as the follow-up of WEB-1, when it was accepted as it was ${shortTime(created.at)}`);
});
