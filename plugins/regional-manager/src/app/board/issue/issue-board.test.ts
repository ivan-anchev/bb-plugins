import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createElement, type ComponentProps } from "react";
import type { IssueRow } from "../../../contract.ts";
import { agentIdSchema } from "../../../model/agent/agent.ts";
import { decisionIdSchema, type Decision, type OpenDecision } from "../../../model/decision.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";

// The board's lanes and rows, driven as the user drives them: what a row shows, folding lanes,
// opening an issue's tab from its row, sub-issues on their rails, and a focused row keeping its focus
// when its issue moves to another lane. board.test.ts reads the board through the plugin's RPC,
// hover-card/hover-card.test.ts opens a row's card, and issue-tab.test.ts the issue's tab.

// why: jsdom has none; the rows measure their titles.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const { IssueBoard } = await import("./issue-board.tsx");

afterEach(cleanup);

const SHA = "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";

function issue(id: string, fields: Partial<IssueRow>): IssueRow {
  return { id: issueIdSchema.parse(id), kind: "build", parentId: null, subIssues: null, blockedBy: [], blocks: [], title: `Issue ${id}`, status: "todo", needsYou: null, headline: "Planned", agent: null, pr: null, ...fields };
}

const QUESTION: OpenDecision = { id: decisionIdSchema.parse("d1"), issueId: null, question: "Which license should the repo use?", options: ["MIT", "Apache-2.0"], askedAt: 1_000, answer: null, cap: null };

const ISSUES: IssueRow[] = [
  issue("WEB-1", { status: "in-progress", needsYou: "Failed after its fix round", headline: "✗ Failed after its fix round", agent: { id: agentIdSchema.parse("a1"), threadId: "thr_one" } }),
  issue("WEB-2", {
    status: "in-review",
    headline: "✓ Verified: added the hello note",
    agent: { id: agentIdSchema.parse("a2"), threadId: "thr_two" },
    pr: { forge: "github", number: 41, url: "https://github.com/acme/notes/pull/41", state: "open", draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] },
  }),
  issue("WEB-3", { status: "verifying", headline: "Waiting for CI on #43" }),
  issue("WEB-4", { status: "in-progress", headline: "Working" }),
  issue("WEB-5", { status: "todo" }),
  issue("WEB-6", { status: "backlog", headline: "Not planned" }),
  issue("WEB-7", { status: "done", headline: "Merged #39" }),
];

/** The board in the root it scrolls in, as the Board tab draws it: a tab stop. */
const Page = (props: ComponentProps<typeof IssueBoard>) => createElement("div", { tabIndex: 0, "aria-label": "Board tab" }, createElement(IssueBoard, props));

/** The board in a side panel that accepts every tab it is asked to open. */
function mount(issues: readonly IssueRow[], decisions: readonly Decision[] = [QUESTION]) {
  const props = (rows: readonly IssueRow[], shown: readonly Decision[]) => ({
    decisions: shown,
    issues: rows,
    decisionRow: (decision: OpenDecision) => createElement("p", { tabIndex: -1 }, decision.question),
  });
  const view = renderSlot({ component: Page }, props(issues, decisions), { experimental_panel: { openTab: () => true } });
  return { view, reread: (rows: readonly IssueRow[], next: readonly Decision[] = decisions) => view.rerender(createElement(Page, props(rows, next))) };
}

/** The issue tab bb is asked to open, as the side panel's `openTab` gets it: its address, the params bb keys it by, and its title. */
const issueTab = (id: string, title: string) => ({ method: "openTab", options: { tab: { id: "issue", context: { kind: "thread" }, availability: "action" }, params: { issueId: id }, title: `${id} ${title}` } });

type View = ReturnType<typeof mount>["view"];
const laneHeader = (view: View, name: RegExp) => view.getByRole("button", { name });
const row = (view: View, id: string) => view.getByRole("button", { name: new RegExp(`^${id}:`) });
const lane = (view: View, name: RegExp) => within(view.getByRole("region", { name }));
/** A row's box: its button, its pills and its pull request. */
const boxOf = (button: HTMLElement): HTMLElement => button.closest<HTMLElement>(".rmi-rowbox") ?? assert.fail("no row box");
/** What a row shows, part by part: its glyph's name, id, title, pills, pull request and ask (null: none). */
function shown(button: HTMLElement) {
  const box = boxOf(button);
  const text = (selector: string) => box.querySelector(selector)?.textContent ?? null;
  return {
    glyph: box.querySelector(".rmi-slot [role=img]")?.getAttribute("aria-label") ?? null,
    id: text(".rmi-row-id"),
    title: text(".rmi-row > .rmi-text"),
    pills: [...box.querySelectorAll(".rmi-pill")].map((pill) => `${pill.getAttribute("data-tone")} ${pill.textContent}`),
    pr: text(".rmi-pr"),
    ask: text(".rmi-ask"),
  };
}

test("Needs you leads with the open decision, then the flagged issue with Needs you's glyph and its ask under its title; the lanes follow in order, the last three folded, and no lane header has a glyph", () => {
  const { view } = mount(ISSUES);

  const headers = view.getAllByRole("heading", { level: 2 });
  assert.deepEqual(headers.map((heading) => heading.textContent), ["Needs you2", "In review1", "Verifying1", "In progress1", "Todo1", "Backlog1", "Done1"]);
  assert.deepEqual(headers.map((heading) => heading.querySelector(".rmi-lane-glyph")), headers.map(() => null), "each row draws its glyph; the lane's header none");

  const needsYou = lane(view, /^Needs you/);
  const [question, flagged] = needsYou.getAllByRole("listitem");
  assert.equal(question?.textContent, QUESTION.question);
  assert.deepEqual(shown(within(flagged ?? assert.fail("no flagged row")).getByRole("button", { name: /^WEB-1:/ })), {
    glyph: "Needs you",
    id: "WEB-1",
    title: "Issue WEB-1",
    pills: [],
    pr: null,
    ask: "Failed after its fix round",
  });
  assert.equal(lane(view, /^In progress/).queryByRole("button", { name: /^WEB-1:/ }), null, "a flagged issue waits under Needs you, not in its status's lane too");

  for (const name of [/^Backlog/, /^Done/]) assert.equal(laneHeader(view, name).getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("button", { name: /^WEB-6:/ }), null);
  assert.equal(view.queryByRole("button", { name: /^WEB-7:/ }), null);
});

test("a row is one line: its status's glyph, its id apart from its title, its title, and its pull request; no kind, no agent, no headline, which its label says", () => {
  const { view } = mount(ISSUES);
  const reviewed = row(view, "WEB-2");

  assert.deepEqual(shown(reviewed), { glyph: "In review", id: "WEB-2", title: "Issue WEB-2", pills: [], pr: "41", ask: null });
  assert.equal(boxOf(reviewed).textContent, "WEB-2Issue WEB-2" + "41", "nothing else on it: no Build, no a2, no headline");
  assert.equal(view.queryByRole("button", { name: /thread/ }), null, "no agent's thread to open from the board");
  assert.equal(reviewed.getAttribute("aria-label"), "WEB-2: Issue WEB-2, In review, ✓ Verified: added the hello note");
  assert.equal(view.container.querySelector<HTMLElement>(".rmi-board")?.style.getPropertyValue("--rmi-id-ch"), "5", "the ids' column is as wide as the longest id, WEB-n");
});

test("the open stages fill one ring clockwise from 12 o'clock, Todo empty, In progress a quarter, Verifying a half, In review three quarters; Done keeps its check", () => {
  const { view } = mount(ISSUES);
  fireEvent.click(laneHeader(view, /^Done/));
  /** The ring's pie: its path, or null for an empty ring. */
  const pie = (id: string) => {
    const svg = boxOf(row(view, id)).querySelector(".rmi-slot svg") ?? assert.fail(`no glyph on ${id}`);
    return { ring: svg.querySelector("circle")?.getAttribute("r"), fill: svg.querySelector("path[fill=currentColor]")?.getAttribute("d") ?? null };
  };
  assert.deepEqual(
    [pie("WEB-5"), pie("WEB-4"), pie("WEB-3"), pie("WEB-2")],
    [
      { ring: "10", fill: null },
      { ring: "10", fill: "M12 12V6a6 6 0 0 1 6 6z" },
      { ring: "10", fill: "M12 6a6 6 0 0 1 0 12z" },
      { ring: "10", fill: "M12 12V6a6 6 0 1 1-6 6z" },
    ],
  );
  const done = boxOf(row(view, "WEB-7")).querySelector(".rmi-slot svg")?.innerHTML ?? "";
  assert.match(done, /d="m9 12 2 2 4-4"/, "Done is the check in a circle");
  assert.equal(boxOf(row(view, "WEB-2")).querySelector(".rmi-slot svg path[d='m9 12 2 2 4-4']"), null, "In review draws no check");
});

test("a row's pills: how many block it and how many it blocks, a count even for one, never an id; never a word on its title's line", () => {
  const blocked = (ids: string[]) => ids.map((each) => issueIdSchema.parse(each));
  const { view } = mount([
    issue("WEB-1", { status: "in-progress", needsYou: "Blocked: Needs a staging key", headline: "Blocked: Needs a staging key", agent: { id: agentIdSchema.parse("a1"), threadId: "thr_one" } }),
    issue("WEB-5", { headline: "Not started", blockedBy: blocked(["WEB-6"]) }),
    issue("WEB-8", { headline: "Not started", blockedBy: blocked(["WEB-6", "WEB-7", "WEB-9"]) }),
    issue("WEB-6", { headline: "Not started", blocks: blocked(["WEB-5", "WEB-8"]) }),
  ]);
  assert.deepEqual(shown(row(view, "WEB-5")).pills, ["blocked 1"], "a lone blocker is counted, not named");
  assert.deepEqual(shown(row(view, "WEB-8")).pills, ["blocked 3"]);
  assert.deepEqual(shown(row(view, "WEB-6")).pills, ["blocking 2"]);
  assert.equal(row(view, "WEB-5").getAttribute("aria-label"), "WEB-5: Issue WEB-5, Todo, blocked by WEB-6, Not started", "the lone blocker is still spoken by its id");
  assert.equal(row(view, "WEB-8").getAttribute("aria-label"), "WEB-8: Issue WEB-8, Todo, blocked by WEB-6, WEB-7, and WEB-9, Not started", "every blocker is spoken");
  assert.equal(row(view, "WEB-6").getAttribute("aria-label"), "WEB-6: Issue WEB-6, Todo, blocks WEB-5 and WEB-8, Not started");

  const flagged = lane(view, /^Needs you/).getByRole("button", { name: /^WEB-1:/ });
  assert.deepEqual([shown(flagged).pills, shown(flagged).ask], [[], "Blocked: Needs a staging key"], "an agent's blocked handoff is its ask, not a pill");
  assert.equal(flagged.getAttribute("aria-label"), "WEB-1: Issue WEB-1, In progress, needs you: Blocked: Needs a staging key", "said once");
  assert.equal(lane(view, /^Needs you/).queryByRole("button", { name: /^WEB-(5|8):/ }), null, "a dependency doesn't put an issue under Needs you");
});

test("a lane's header unfolds and folds its rows, and focus stays on the header", () => {
  const { view } = mount(ISSUES);
  const done = laneHeader(view, /^Done/);
  done.focus();

  fireEvent.click(done);
  assert.equal(done.getAttribute("aria-expanded"), "true");
  assert.ok(row(view, "WEB-7"));
  assert.equal(document.getElementById(done.getAttribute("aria-controls") ?? "")?.tagName, "UL");

  const inReview = laneHeader(view, /^In review/);
  fireEvent.click(inReview);
  assert.equal(inReview.getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("button", { name: /^WEB-2:/ }), null);

  fireEvent.click(done);
  assert.equal(view.queryByRole("button", { name: /^WEB-7:/ }), null);
  assert.ok(document.activeElement === done, "focus stays on the header");
});

test("a row opens its issue in its own tab, titled with its id and title, and pressing it again asks for the same tab, which bb focuses rather than adding a second", () => {
  const { view } = mount(ISSUES);
  const todo = row(view, "WEB-5");
  assert.equal(todo.hasAttribute("aria-expanded"), false, "a row opens nothing in place");

  fireEvent.click(todo);
  fireEvent.click(row(view, "WEB-4"));
  fireEvent.click(todo);

  // why the same call twice: bb keys an action tab by its params, so opening the same params again selects the tab open for them.
  assert.deepEqual(view.experimental_panelCalls, [issueTab("WEB-5", "Issue WEB-5"), issueTab("WEB-4", "Issue WEB-4"), issueTab("WEB-5", "Issue WEB-5")]);
  assert.equal(view.queryByRole("region", { name: "WEB-5" }), null, "and draws no detail on the board");
});

test("a row's pull request links it, apart from opening the issue", () => {
  const { view } = mount(ISSUES);
  const pr = view.getByRole("link", { name: "Pull request 41, open, CI passing" });
  assert.equal(pr.getAttribute("href"), "https://github.com/acme/notes/pull/41");
  assert.equal(pr.textContent, "41", "GitHub's number bare, as Activity Sidebar's badge");
  fireEvent.click(pr);
  assert.deepEqual(view.experimental_panelCalls, [], "and opens no tab");
});

test("a row's merge request on GitLab reads !41 and links it; a pipeline blocked on a manual job shows the running dot and says so", () => {
  const url = "https://gitlab.corp.test/frontend/station-ws/-/merge_requests/41";
  const { view } = mount([issue("WEB-2", { status: "in-review", pr: { forge: "gitlab", number: 41, url, state: "open", draft: false, review: "none", ci: "blocked", headSha: SHA, failedChecks: [] } })]);
  const mr = view.getByRole("link", { name: "Merge request !41, open, CI blocked on a manual job" });
  assert.equal(mr.getAttribute("title"), "Merge request !41, open, CI blocked on a manual job", "the tooltip reads the number as the badge shows it");
  assert.equal(mr.getAttribute("href"), url);
  assert.equal(mr.textContent, "!41");
  assert.equal(mr.querySelector(".rmi-ci")?.getAttribute("data-ci"), "blocked");
});

test("a focused row whose issue moves to another lane keeps focus there", () => {
  const { view, reread } = mount(ISSUES);
  row(view, "WEB-4").focus();

  act(() => reread(ISSUES.map((each) => (each.id === "WEB-4" ? { ...each, status: "verifying", headline: "Verifying: added it" } : each))));

  assert.ok(document.activeElement === lane(view, /^Verifying/).getByRole("button", { name: /^WEB-4:/ }), "focus moved with the row");
});
const moved = (id: string, fields: Partial<IssueRow>) => ISSUES.map((each) => (each.id === id ? { ...each, ...fields } : each));

test("a focused row whose issue moves into a folded lane hands focus to that lane's header", () => {
  const { view, reread } = mount(ISSUES);
  row(view, "WEB-4").focus();

  act(() => reread(moved("WEB-4", { status: "done", headline: "Merged #44" })));

  const done = laneHeader(view, /^Done/);
  assert.equal(done.getAttribute("aria-expanded"), "false");
  assert.ok(document.activeElement === done, "focus is on Done's header");
});

test("a focused row whose issue is gone from the next read hands focus to the page the board scrolls in", () => {
  const { view, reread } = mount([issue("WEB-1", {}), issue("WEB-2", {})], []);
  row(view, "WEB-1").focus();

  act(() => reread([issue("WEB-2", {})]));

  assert.equal(view.queryByRole("button", { name: /^WEB-1:/ }), null);
  assert.ok(document.activeElement === view.getByLabelText("Board tab"), "focus is on the tab's tab stop, not the body");
});

test("focus on a row's pull request moves with the issue, to its row where it lands", () => {
  const { view, reread } = mount(ISSUES);
  view.getByRole("link", { name: /^Pull request 41/ }).focus();
  act(() => reread(moved("WEB-2", { status: "verifying", headline: "Waiting for CI on #41" })));
  assert.ok(document.activeElement === lane(view, /^Verifying/).getByRole("button", { name: /^WEB-2:/ }));
});

const I1 = issueIdSchema.parse("WEB-1");
const STAGING = "Blocked: Needs a staging key";

/** A parent In progress, WEB-1, with three sub-issues: one Done, one flagged by its agent's blocked handoff, one blocked by a dependency; and a top-level Todo that blocks it. */
const SPLIT: IssueRow[] = [
  issue("WEB-1", { title: "Card vault", status: "in-progress", subIssues: { done: 1, total: 3 }, headline: null }),
  issue("WEB-2", { parentId: I1, status: "done", headline: "Merged #12" }),
  issue("WEB-3", { parentId: I1, status: "in-progress", needsYou: STAGING, headline: STAGING, agent: { id: agentIdSchema.parse("a3"), threadId: "thr_three" } }),
  issue("WEB-4", { parentId: I1, status: "todo", headline: "Not started", blockedBy: [issueIdSchema.parse("WEB-5")] }),
  issue("WEB-5", { status: "todo", headline: "Not started", blocks: [issueIdSchema.parse("WEB-4")] }),
];

/** The rows in a list, top level only, each with the rows hung under it: an issue's by its id, the completed row by its words. */
const rowsIn = (list: HTMLElement): string[][] =>
  [...list.children].map((item) => [...item.querySelectorAll<HTMLElement>(".rmi-row")].map((button) => /^WEB-\d+/.exec(button.getAttribute("aria-label") ?? "")?.[0] ?? button.textContent ?? "?"));

test("a parent's sub-issues hang under it in its lane on elbow rails, each with its own glyph, its Done ones behind a completed row while it is In progress, the parent counting them Done in a pill; a lane counts its top-level rows", () => {
  const { view } = mount(SPLIT, []);
  const headers = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  assert.deepEqual(headers, ["Needs you1", "In progress1", "Todo1"], "the parent counts once in its lane, its sub-issues by its own count");

  const working = view.getByRole("region", { name: /^In progress/ });
  assert.deepEqual(rowsIn(within(working).getAllByRole("list")[0] ?? assert.fail("no list")), [["WEB-1", "WEB-3", "WEB-4", "+1 completed"]], "the open ones under the parent, whatever their own status, then the Done one folded");
  const subs = within(working).getAllByRole("list")[1] ?? assert.fail("no sub-issue list");
  const items = within(subs).getAllByRole("listitem");
  assert.deepEqual(
    items.slice(0, 2).map((item) => shown(within(item).getByRole("button"))),
    [
      { glyph: "Needs you", id: "WEB-3", title: "Issue WEB-3", pills: [], pr: null, ask: null },
      { glyph: "Todo", id: "WEB-4", title: "Issue WEB-4", pills: ["blocked 1"], pr: null, ask: null },
    ],
    "one line each: a flagged one asks under Needs you, not here",
  );
  // why the path: the trunk comes down from the parent's glyph (above the tree's top) into the first, bends into each, and stops at the last.
  const rails = items.map((item) => item.querySelector(".rmi-rails path")?.getAttribute("d") ?? assert.fail("no rails"));
  assert.match(rails[0] ?? "", /^M14\.5 -8V11A4 4 0 0 0 18\.5 15H26M14\.5 11V30$/, "the first reaches up to the parent's glyph and runs on");
  assert.match(rails[1] ?? "", /^M14\.5 0V11A4 4 0 0 0 18\.5 15H26M14\.5 11V30$/);
  assert.match(rails[2] ?? "", /^M14\.5 0V11A4 4 0 0 0 18\.5 15H26$/, "the completed row is the last: it bends in and stops");

  const parent = row(view, "WEB-1");
  assert.deepEqual(shown(parent), { glyph: "In progress", id: "WEB-1", title: "Card vault", pills: ["count 1/3"], pr: null, ask: null });
  assert.equal(parent.getAttribute("aria-label"), "WEB-1: Card vault, In progress, 1 of 3 sub-issues done");
  assert.deepEqual(shown(row(view, "WEB-5")).pills, ["blocking 1"]);
  assert.equal(lane(view, /^Todo/).queryByRole("button", { name: /^WEB-4:/ }), null, "a Todo sub-issue sits in its parent's lane, not Todo");
});

/** The user's pointer and keys. why no hover on the way to a click: resting on a row opens its card after a beat, whose timers outlive the test. */
const pressing = () => userEvent.setup({ skipHover: true });

/** A parent's count, the button that folds its sub-issues. */
const countOf = (view: View, id: string): HTMLElement => within(boxOf(row(view, id))).getByRole("button", { name: /^Sub-issues,/ });
/** The ids of the issue rows under a parent, its own first; null when its sub-issues are folded away. */
const underParent = (view: View, id: string): string[] | null => {
  const item = boxOf(row(view, id)).parentElement ?? assert.fail("no item");
  return item.querySelector(".rmi-sub-issues") === null ? null : rowsIn(item.parentElement ?? assert.fail("no list")).find(([first]) => first === id) ?? null;
};

test("a parent's count folds and unfolds its sub-issues and their rails, by click, Enter and Space, saying whether they show; the rest of the row still opens the issue", async () => {
  const user = pressing();
  const { view } = mount(SPLIT, []);
  const count = countOf(view, "WEB-1");
  assert.equal(count.tagName, "BUTTON");
  assert.equal(count.querySelector(".rmi-chevron, [class*=chevron]"), null, "no chevron drawn");
  assert.equal(count.textContent, "1/3");
  assert.equal(count.getAttribute("aria-expanded"), "true", "sub-issues show at first, as they did before the count folded them");
  assert.equal(document.getElementById(count.getAttribute("aria-controls") ?? "")?.className, "rmi-list rmi-sub-issues", "it names the list it folds");

  await user.click(count);
  assert.equal(count.getAttribute("aria-expanded"), "false");
  assert.equal(count.hasAttribute("aria-controls"), false, "it names no list that isn't there");
  assert.equal(underParent(view, "WEB-1"), null, "the sub-issues are gone");
  assert.equal(boxOf(row(view, "WEB-1")).parentElement?.querySelector(".rmi-rails"), null, "and their rails with them");
  assert.deepEqual(shown(row(view, "WEB-1")).pills, ["count 1/3"], "the folded parent still shows its count");
  assert.ok(lane(view, /^Needs you/).getByRole("button", { name: /^WEB-3:/ }), "a flagged sub-issue still waits under Needs you");

  await user.keyboard("{Enter}");
  assert.equal(count.getAttribute("aria-expanded"), "true", "Enter unfolds them");
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "WEB-4", "+1 completed"]);
  await user.keyboard(" ");
  assert.equal(count.getAttribute("aria-expanded"), "false", "Space folds them");
  assert.equal(underParent(view, "WEB-1"), null);
  await user.keyboard(" ");
  assert.equal(count.getAttribute("aria-expanded"), "true", "Space unfolds them");

  assert.deepEqual(view.experimental_panelCalls, [], "folding opened no tab");
  fireEvent.click(boxOf(row(view, "WEB-1")).querySelector(".rmi-row-id") ?? assert.fail("no id"));
  assert.deepEqual(view.experimental_panelCalls, [issueTab("WEB-1", "Card vault")], "the rest of the row opens the issue");
  assert.equal(count.getAttribute("aria-expanded"), "true", "and folds nothing");
});

test("a parent folded stays folded as its sub-issues change and it moves lanes; a parent whose every sub-issue is canceled shows no count", () => {
  const { view, reread } = mount(SPLIT, []);
  fireEvent.click(countOf(view, "WEB-1"));
  act(() => reread(SPLIT.map((each) => (each.id === "WEB-1" ? { ...each, status: "in-review" as const } : each.id === "WEB-4" ? { ...each, status: "in-progress" as const } : each))));
  assert.equal(countOf(view, "WEB-1").getAttribute("aria-expanded"), "false");
  assert.equal(underParent(view, "WEB-1"), null);

  const allCanceled = [issue("WEB-1", { status: "todo", subIssues: { done: 0, total: 0 }, headline: null }), issue("WEB-2", { parentId: I1, status: "canceled", headline: "Canceled" })];
  act(() => reread(allCanceled));
  assert.deepEqual(shown(row(view, "WEB-1")).pills, [], "no 0/0: nothing to count, nothing to fold");
  assert.equal(within(boxOf(row(view, "WEB-1"))).queryByRole("button", { name: /^Sub-issues,/ }), null);
  assert.equal(row(view, "WEB-1").getAttribute("aria-label"), "WEB-1: Issue WEB-1, Todo", "nor said");
});

test("canceled sub-issues are never listed under their parent, unfolded or not; each is its own row under Canceled, naming its parent", () => {
  const canceled = (id: string) => issue(id, { parentId: I1, status: "canceled", headline: "Canceled" });
  const { view } = mount([...SPLIT.map((each) => (each.id === "WEB-1" ? { ...each, subIssues: { done: 1, total: 3 } } : each)), canceled("WEB-6"), canceled("WEB-7")], []);
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "WEB-4", "+1 completed"]);
  fireEvent.click(view.getByRole("button", { name: "1 completed sub-issues" }));
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "WEB-4", "+1 completed", "WEB-2"], "unfolded, the Done one shows; no canceled one");
  assert.deepEqual(shown(row(view, "WEB-1")).pills, ["count 1/3"], "the count the read sends, which leaves them out (status.test.ts)");

  const canceledLane = laneHeader(view, /^Canceled/);
  assert.equal(canceledLane.textContent, "Canceled2", "each counts as its own row");
  fireEvent.click(canceledLane);
  const rows = lane(view, /^Canceled/).getAllByRole("button", { name: /^WEB-/ });
  assert.deepEqual(rows.map((each) => [shown(each).id, shown(each).glyph]), [["WEB-1›WEB-6", "Canceled"], ["WEB-1›WEB-7", "Canceled"]], "each names its parent ahead of its id");
  assert.match(rows[0]?.getAttribute("aria-label") ?? "", /^WEB-6: Issue WEB-6, sub-issue of WEB-1, Canceled/, "and says it");
  fireEvent.click(rows[0] ?? assert.fail("no row"));
  assert.deepEqual(view.experimental_panelCalls, [issueTab("WEB-6", "Issue WEB-6")], "and opens its issue");
});

test("while its parent isn't Done, its Done sub-issues fold behind one '+N completed' row at the end, which unfolds them in place with the count's semantics; a Done parent lists them all", async () => {
  const user = pressing();
  const family = (parent: Partial<IssueRow>) => [
    issue("WEB-1", { title: "Card vault", status: "in-progress", subIssues: { done: 2, total: 3 }, headline: null, ...parent }),
    issue("WEB-2", { parentId: I1, status: "done", headline: "Merged #12" }),
    issue("WEB-3", { parentId: I1, status: "in-progress", headline: "Working" }),
    issue("WEB-4", { parentId: I1, status: "done", headline: "Merged #14" }),
    issue("WEB-5", { parentId: I1, status: "canceled", headline: "Canceled" }),
  ];
  const { view, reread } = mount(family({}), []);
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "+2 completed"], "one row for both, at the end");

  const completed = view.getByRole("button", { name: "2 completed sub-issues" });
  assert.equal(completed.getAttribute("aria-expanded"), "false");
  assert.equal(completed.hasAttribute("aria-controls"), false);
  assert.equal(completed.textContent, "+2 completed", "its words alone, no glyph");
  assert.equal(within(completed).queryByRole("img"), null);
  assert.equal(completed.querySelector(".rmi-slot"), null, "no glyph slot ahead of its words: they start where the sub-issues' glyphs do");
  await user.click(completed);
  assert.equal(completed.getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById(completed.getAttribute("aria-controls") ?? ""), boxOf(row(view, "WEB-3")).closest("ul"), "it names the list they unfold in");
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "+2 completed", "WEB-2", "WEB-4"], "in place, under it");
  assert.deepEqual(view.experimental_panelCalls, [], "it opens no tab");
  await user.keyboard("{Enter}");
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "+2 completed"], "Enter folds them");
  await user.keyboard(" ");
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "+2 completed", "WEB-2", "WEB-4"], "Space unfolds them");

  act(() => reread(family({ status: "verifying", headline: "Final check running" })));
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-3", "+2 completed", "WEB-2", "WEB-4"], "still unfolded as the parent moves on, not yet Done");

  act(() => reread(family({ status: "done", headline: "✓ Final check passed" })));
  fireEvent.click(laneHeader(view, /^Done/));
  assert.deepEqual(underParent(view, "WEB-1"), ["WEB-1", "WEB-2", "WEB-3", "WEB-4"], "a Done parent lists each, in order, no completed row, no canceled one");
});

test("focus on a completed row that goes, its last Done sub-issue reopened, moves to its parent's row", () => {
  const rows = (status: IssueRow["status"]) => [issue("WEB-1", { status: "in-progress", subIssues: { done: 1, total: 2 }, headline: null }), issue("WEB-2", { parentId: I1, status }), issue("WEB-3", { parentId: I1, status: "in-progress" })];
  const { view, reread } = mount(rows("done"), []);
  view.getByRole("button", { name: "1 completed sub-issues" }).focus();
  act(() => reread(rows("in-progress")));
  assert.equal(view.queryByRole("button", { name: /completed sub-issues/ }), null);
  assert.ok(document.activeElement === row(view, "WEB-1"), "on its parent's row, not the page");
});

test("a flagged parent asks under its title under Needs you, its sub-issues hanging from its glyph past that line", () => {
  const unmerged = "WEB-2 isn't merged, so WEB-1's work isn't all on the default branch";
  const { view } = mount(SPLIT.map((each) => (each.id === "WEB-1" ? { ...each, needsYou: unmerged, headline: unmerged } : each)), []);
  const parent = lane(view, /^Needs you/).getByRole("button", { name: /^WEB-1:/ });
  assert.deepEqual(shown(parent), { glyph: "Needs you", id: "WEB-1", title: "Card vault", pills: ["count 1/3"], pr: null, ask: unmerged });
  const first = boxOf(parent).parentElement?.querySelector(".rmi-sub-issues .rmi-rails path")?.getAttribute("d");
  assert.match(first ?? "", /^M14\.5 -26V/, "the first rail reaches up past the ask line to the glyph");
});

test("a flagged sub-issue hangs under its parent and sits flat under Needs you with its ask, each naming its parent to a screen reader and the flat one ahead of its id; both open its one tab", () => {
  const { view } = mount(SPLIT, []);
  const flat = lane(view, /^Needs you/).getByRole("button", { name: /^WEB-3:/ });
  assert.equal(flat.getAttribute("aria-label"), `WEB-3: Issue WEB-3, sub-issue of WEB-1, In progress, needs you: ${STAGING}`);
  assert.deepEqual(shown(flat), { glyph: "Needs you", id: "WEB-1›WEB-3", title: "Issue WEB-3", pills: [], pr: null, ask: STAGING }, "its parent's id and its own read as one");
  const nested = lane(view, /^In progress/).getByRole("button", { name: /^WEB-3:/ });
  assert.match(nested.getAttribute("aria-label") ?? "", /^WEB-3: Issue WEB-3, sub-issue of WEB-1, In progress,/, "under its parent too, for a reader who reaches it straight");
  assert.equal(shown(nested).id, "WEB-3", "where it shows no breadcrumb");

  fireEvent.click(flat);
  fireEvent.click(nested);
  assert.deepEqual(view.experimental_panelCalls, [issueTab("WEB-3", "Issue WEB-3"), issueTab("WEB-3", "Issue WEB-3")]);
});

test("folding a parent's lane folds its sub-issues with it", () => {
  const { view } = mount(SPLIT, []);
  fireEvent.click(laneHeader(view, /^In progress/));
  assert.deepEqual(["WEB-1", "WEB-2", "WEB-4"].map((id) => view.queryByRole("button", { name: new RegExp(`^${id}:`) })), [null, null, null]);
  assert.ok(lane(view, /^Needs you/).getByRole("button", { name: /^WEB-3:/ }), "the flagged copy stays under Needs you");
});

test("focus on a sub-issue's row stays on it as it changes status under its parent, moves lanes with its parent, and leaves its parent for a lane of its own", () => {
  const { view, reread } = mount(SPLIT, []);
  const under = (id: string, name: RegExp) => lane(view, name).getByRole("button", { name: new RegExp(`^${id}:`) });
  under("WEB-4", /^In progress/).focus();

  act(() => reread(SPLIT.map((each) => (each.id === "WEB-4" ? { ...each, status: "in-progress", headline: "Working", blockedBy: [] } : each))));
  assert.ok(document.activeElement === under("WEB-4", /^In progress/), "its status changed, its row stayed");

  const reviewing = SPLIT.map((each) => (each.id === "WEB-1" ? { ...each, status: "in-review" as const } : each));
  act(() => reread(reviewing));
  assert.ok(document.activeElement === under("WEB-4", /^In review/), "moved with its parent, focus on its own row, not the parent's");

  act(() => reread(reviewing.map((each) => (each.id === "WEB-4" ? { ...each, parentId: null } : each))));
  assert.ok(document.activeElement === under("WEB-4", /^Todo/), "top-level now, in its own lane");
});

test("focus on a flagged sub-issue's row under Needs you moves to its row under its parent once its flag clears", () => {
  const { view, reread } = mount(SPLIT, []);
  lane(view, /^Needs you/).getByRole("button", { name: /^WEB-3:/ }).focus();
  act(() => reread(SPLIT.map((each) => (each.id === "WEB-3" ? { ...each, needsYou: null, headline: "Working" } : each))));
  assert.ok(document.activeElement === lane(view, /^In progress/).getByRole("button", { name: /^WEB-3:/ }));
});
