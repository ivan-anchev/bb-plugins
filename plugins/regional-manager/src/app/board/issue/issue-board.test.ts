import "../../test-browser.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import type { IssueRow } from "../../../contract.ts";
import { agentIdSchema } from "../../../model/agent.ts";
import { decisionIdSchema, type Decision, type OpenDecision } from "../../../model/decision.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";

// The board's lanes and rows, driven as the user drives them: folding lanes, opening an issue's tab
// from its row, and a focused row keeping its focus when its issue moves to another lane. board.test.ts
// reads the board through the plugin's RPC, and issue-tab.test.ts the issue's tab.

// why: the board brings its stylesheet, which bb's build bundles and node can't load.
registerHooks({ load: (url, context, nextLoad) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context)) });
// why: jsdom has none of these; the rows measure their titles, and the working ring asks for Reduce motion and a canvas.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
HTMLCanvasElement.prototype.getContext = () => null;

const { IssueBoard } = await import("./issue-board.tsx");

afterEach(cleanup);

const SHA = "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";

function issue(id: string, fields: Partial<IssueRow>): IssueRow {
  return { id: issueIdSchema.parse(id), kind: "build", parentId: null, subIssues: null, blockedBy: [], title: `Issue ${id}`, status: "todo", needsYou: null, headline: "Planned", agent: null, pr: null, ...fields };
}

const QUESTION: OpenDecision = { id: decisionIdSchema.parse("d1"), issueId: null, question: "Which license should the repo use?", options: ["MIT", "Apache-2.0"], askedAt: 1_000, answer: null };

const ISSUES: IssueRow[] = [
  issue("WEB-1", { status: "in-progress", needsYou: "Failed after its fix round", headline: "✗ Failed after its fix round", agent: { id: agentIdSchema.parse("a1"), threadId: "thr_one" } }),
  issue("WEB-2", {
    status: "in-review",
    headline: "✓ Verified: added the hello note",
    agent: { id: agentIdSchema.parse("a2"), threadId: "thr_two" },
    pr: { number: 41, url: "https://github.com/acme/notes/pull/41", state: "open", draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] },
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

const laneHeader = (view: ReturnType<typeof mount>["view"], name: RegExp) => view.getByRole("button", { name });
const row = (view: ReturnType<typeof mount>["view"], id: string) => view.getByRole("button", { name: new RegExp(`\\b${id} Build`) });
const lane = (view: ReturnType<typeof mount>["view"], name: RegExp) => within(view.getByRole("region", { name }));

test("Needs you leads with the open decision, then the flagged issue showing its own status; the lanes follow in order, the last three folded", () => {
  const { view } = mount(ISSUES);

  const headers = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  assert.deepEqual(headers, ["Needs you2", "In review1", "Verifying1", "In progress1", "Todo1", "Backlog1", "Done1"]);

  const needsYou = lane(view, /^Needs you/);
  const [question, flagged] = needsYou.getAllByRole("listitem");
  assert.equal(question?.textContent, QUESTION.question);
  assert.ok(flagged !== undefined && within(flagged).getByRole("img", { name: "In progress" }));
  assert.equal(lane(view, /^In progress/).queryByRole("button", { name: /\bWEB-1 Build/ }), null, "a flagged issue waits under Needs you, not in its status's lane too");

  for (const name of [/^Backlog/, /^Done/]) assert.equal(laneHeader(view, name).getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("button", { name: /\bWEB-6 Build/ }), null);
  assert.equal(view.queryByRole("button", { name: /\bWEB-7 Build/ }), null);
});

test("a decision sits under Needs you until the user answers it, then on no lane, and focus on it goes to the page", () => {
  const todo = [issue("WEB-5", { status: "todo" })];
  const { view, reread } = mount(todo, [QUESTION]);
  const question = lane(view, /^Needs you/).getByText(QUESTION.question);
  question.focus();

  reread(todo, [{ ...QUESTION, answer: { text: "MIT", at: 2_000 } }]);

  assert.deepEqual(view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent), ["Todo1"], "no Needs you, and no Done for it");
  assert.equal(view.queryByText(QUESTION.question), null);
  assert.equal(document.activeElement, view.getByLabelText("Board tab"), "focus goes to the page, not the body");
});

test("a row says what blocks it ahead of its headline, naming two and counting the rest, in its status's lane; an agent's blocked handoff stays its own headline under Needs you", () => {
  const blocked = (ids: string[]) => ids.map((each) => issueIdSchema.parse(each));
  const { view } = mount([
    issue("WEB-1", { status: "in-progress", needsYou: "Blocked: Needs a staging key", headline: "Blocked: Needs a staging key", agent: { id: agentIdSchema.parse("a1"), threadId: "thr_one" } }),
    issue("WEB-5", { headline: "Not started", blockedBy: blocked(["WEB-6"]) }),
    issue("WEB-8", { headline: "Not started", blockedBy: blocked(["WEB-6", "WEB-7", "WEB-9"]) }),
    issue("WEB-6", { headline: "Not started" }),
  ]);
  const todo = lane(view, /^Todo/);
  assert.match(todo.getByRole("button", { name: /\bWEB-5 Build/ }).textContent ?? "", /blocked by WEB-6Not started$/);
  assert.match(todo.getByRole("button", { name: /\bWEB-8 Build/ }).textContent ?? "", /blocked by WEB-6, WEB-7 \+1Not started$/, "two named, the rest counted, on its one line");
  assert.match(row(view, "WEB-8").getAttribute("aria-label") ?? "", /, Todo, blocked by WEB-6, WEB-7, and WEB-9, Not started$/, "every blocker is spoken");
  assert.doesNotMatch(row(view, "WEB-6").textContent ?? "", /blocked/i, "nothing blocks it, so nothing says so");

  const flagged = lane(view, /^Needs you/).getByRole("button", { name: /\bWEB-1 Build/ });
  assert.match(flagged.textContent ?? "", /Blocked: Needs a staging key$/);
  assert.doesNotMatch(flagged.textContent ?? "", /blocked by/);
  assert.equal(lane(view, /^Needs you/).queryByRole("button", { name: /\bi(5|8) Build/ }), null, "a dependency doesn't put an issue under Needs you");
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
  assert.equal(view.queryByRole("button", { name: /\bWEB-2 Build/ }), null);

  fireEvent.click(done);
  assert.equal(view.queryByRole("button", { name: /\bWEB-7 Build/ }), null);
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
test("a focused row whose issue moves to another lane keeps focus there", () => {
  const { view, reread } = mount(ISSUES);
  row(view, "WEB-4").focus();

  act(() => reread(ISSUES.map((each) => (each.id === "WEB-4" ? { ...each, status: "verifying", headline: "Verifying: added it" } : each))));

  assert.ok(document.activeElement === lane(view, /^Verifying/).getByRole("button", { name: /\bWEB-4 Build/ }), "focus moved with the row");
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

  assert.equal(view.queryByRole("button", { name: /\bWEB-1 Build/ }), null);
  assert.ok(document.activeElement === view.getByLabelText("Board tab"), "focus is on the tab's tab stop, not the body");
});

test("focus on a row's agent link moves with the issue, to its row where it lands", () => {
  const { view, reread } = mount(ISSUES);
  view.getByRole("button", { name: "Open a2's thread" }).focus();
  act(() => reread(moved("WEB-2", { status: "verifying", headline: "Waiting for CI on #41" })));
  assert.ok(document.activeElement === lane(view, /^Verifying/).getByRole("button", { name: /\bWEB-2 Build/ }));
});
test("a row links its agent's thread and its pull request with CI, apart from opening it", () => {
  const { view } = mount(ISSUES);

  const pr = view.getByRole("link", { name: "Pull request 41, open, CI passing" });
  assert.equal(pr.getAttribute("href"), "https://github.com/acme/notes/pull/41");

  fireEvent.click(view.getByRole("button", { name: "Open a2's thread" }));
  assert.deepEqual(
    view.navigateCalls.map((call) => call.method === "toThread" && call.threadId),
    ["thr_two"],
  );
  assert.deepEqual(view.experimental_panelCalls, [], "and opens no tab");
});

const I1 = issueIdSchema.parse("WEB-1");
const STAGING = "Blocked: Needs a staging key";

/** A parent In progress, WEB-1, with three sub-issues: one Done, one flagged by its agent's blocked handoff, one blocked by a dependency; and a top-level Todo. */
const SPLIT: IssueRow[] = [
  issue("WEB-1", { title: "Card vault", status: "in-progress", subIssues: { done: 1, total: 3 }, headline: null }),
  issue("WEB-2", { parentId: I1, status: "done", headline: "Merged #12" }),
  issue("WEB-3", { parentId: I1, status: "in-progress", needsYou: STAGING, headline: STAGING, agent: { id: agentIdSchema.parse("a3"), threadId: "thr_three" } }),
  issue("WEB-4", { parentId: I1, status: "todo", headline: "Not started", blockedBy: [issueIdSchema.parse("WEB-5")] }),
  issue("WEB-5", { status: "todo", headline: "Not started" }),
];

/** The ids of the issue rows in a list, top level only, each with the ids of the rows indented under it. */
const rowsIn = (list: HTMLElement): string[][] =>
  [...list.children].map((item) => [...item.querySelectorAll<HTMLElement>(".rmi-row")].map((button) => /^WEB-\d+/.exec(button.getAttribute("aria-label") ?? "")?.[0] ?? "?"));

test("a parent's sub-issues sit indented under it in its lane, each with its own glyph, the parent counting them where an agent would be; a lane counts its top-level rows", () => {
  const { view } = mount(SPLIT, []);
  const headers = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  assert.deepEqual(headers, ["Needs you1", "In progress1", "Todo1"], "the parent counts once in its lane, its sub-issues by its own count");

  const working = view.getByRole("region", { name: /^In progress/ });
  assert.deepEqual(rowsIn(within(working).getAllByRole("list")[0] ?? assert.fail("no list")), [["WEB-1", "WEB-2", "WEB-3", "WEB-4"]], "all three under the parent, whatever their own status");
  const subs = within(working).getAllByRole("list")[1] ?? assert.fail("no sub-issue list");
  assert.deepEqual(
    within(subs).getAllByRole("button", { name: /^WEB-\d Build/ }).map((button) => within(button).getByRole("img").getAttribute("aria-label")),
    ["Done", "In progress", "Todo"],
  );
  assert.match(within(subs).getByRole("button", { name: /\bWEB-4 Build/ }).textContent ?? "", /blocked by WEB-5/);
  const parent = row(view, "WEB-1");
  assert.equal(parent.closest(".rmi-rowbox")?.querySelector(".rmi-count-cell")?.textContent, "1/3");
  assert.match(parent.getAttribute("aria-label") ?? "", /, In progress, 1 of 3 sub-issues done$/);
  assert.equal(lane(view, /^Todo/).queryByRole("button", { name: /\bWEB-4 Build/ }), null, "a Todo sub-issue sits in its parent's lane, not Todo");
});

test("a parent says its count once, on its first line at the right, headline or not; with none the row is that one line", () => {
  const unmerged = "WEB-2 isn't merged, so WEB-1's work isn't all on the default branch";
  const { view, reread } = mount(SPLIT, []);
  const counted = () => {
    const box = row(view, "WEB-1").closest(".rmi-rowbox") ?? assert.fail("no row box");
    return {
      words: row(view, "WEB-1").textContent,
      count: box.querySelector(".rmi-count-cell")?.textContent,
      oneLine: box.hasAttribute("data-one-line"),
      secondLine: box.querySelector(".rmi-headline") !== null,
      label: row(view, "WEB-1").getAttribute("aria-label"),
    };
  };
  assert.deepEqual(counted(), { words: "WEB-1BuildCard vault", count: "1/3", oneLine: true, secondLine: false, label: "WEB-1 Build: Card vault, In progress, 1 of 3 sub-issues done" });

  act(() => reread(SPLIT.map((each) => (each.id === "WEB-1" ? { ...each, needsYou: unmerged, headline: unmerged } : each))));
  assert.deepEqual(
    counted(),
    { words: `WEB-1BuildCard vault${unmerged}`, count: "1/3", oneLine: false, secondLine: true, label: `WEB-1 Build: Card vault, In progress, 1 of 3 sub-issues done, ${unmerged}` },
  );
});

test("a flagged sub-issue sits under its parent and flat under Needs you, each naming its parent to a screen reader and the flat one ahead of its id; both open its one tab", () => {
  const { view } = mount(SPLIT, []);
  const flat = lane(view, /^Needs you/).getByRole("button", { name: /\bWEB-3 Build/ });
  assert.match(flat.getAttribute("aria-label") ?? "", /^WEB-3 Build: Issue WEB-3, sub-issue of WEB-1, In progress,/);
  assert.match(flat.textContent ?? "", /^WEB-1›WEB-3Build/, "its parent's id and its own read as one");
  assert.ok(within(flat).getByRole("img", { name: "In progress" }), "with its own status's glyph");
  const nested = lane(view, /^In progress/).getByRole("button", { name: /\bWEB-3 Build/ });
  assert.match(nested.getAttribute("aria-label") ?? "", /^WEB-3 Build: Issue WEB-3, sub-issue of WEB-1, In progress,/, "under its parent too, for a reader who reaches it straight");
  assert.equal(nested.textContent?.includes("›"), false, "where it shows no breadcrumb");

  fireEvent.click(flat);
  fireEvent.click(nested);
  assert.deepEqual(view.experimental_panelCalls, [issueTab("WEB-3", "Issue WEB-3"), issueTab("WEB-3", "Issue WEB-3")]);
});

test("folding a parent's lane folds its sub-issues with it", () => {
  const { view } = mount(SPLIT, []);
  fireEvent.click(laneHeader(view, /^In progress/));
  assert.deepEqual(["WEB-1", "WEB-2", "WEB-4"].map((id) => view.queryByRole("button", { name: new RegExp(`\\b${id} Build`) })), [null, null, null]);
  assert.ok(lane(view, /^Needs you/).getByRole("button", { name: /\bWEB-3 Build/ }), "the flagged copy stays under Needs you");
});

test("focus on a sub-issue's row stays on it as it changes status under its parent, moves lanes with its parent, and leaves its parent for a lane of its own", () => {
  const { view, reread } = mount(SPLIT, []);
  const under = (id: string, name: RegExp) => lane(view, name).getByRole("button", { name: new RegExp(`\\b${id} Build`) });
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
  lane(view, /^Needs you/).getByRole("button", { name: /\bWEB-3 Build/ }).focus();
  act(() => reread(SPLIT.map((each) => (each.id === "WEB-3" ? { ...each, needsYou: null, headline: "Working" } : each))));
  assert.ok(document.activeElement === lane(view, /^In progress/).getByRole("button", { name: /\bWEB-3 Build/ }));
});

test("every rule in the board's stylesheet is scoped to the board, so none reaches bb or another plugin", async () => {
  // why read the file: bb doesn't scope a plugin's stylesheet, so a bare selector styles the whole page.
  const css = (await readFile(new URL("./issue-board.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap(([, prelude = ""]) => (prelude.trim().startsWith("@") ? [] : prelude.split(",").map((selector) => selector.trim())));
  assert.ok(selectors.length > 50, "the stylesheet's rules were read");
  assert.deepEqual(
    selectors.filter((selector) => !selector.includes(".rmi-")),
    [],
  );
});
