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
import { decisionIdSchema, type Decision } from "../../../model/decision.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";

// The board's lanes and in-place detail, driven as the user drives them: folding lanes, opening rows,
// and an open row keeping its place and focus when its issue moves to another lane. board.test.ts
// reads the detail through the plugin's RPC.

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

const QUESTION: Decision = { id: decisionIdSchema.parse("d1"), issueId: null, question: "Which license should the repo use?", options: ["MIT", "Apache-2.0"], askedAt: 1_000, answer: null };

const ISSUES: IssueRow[] = [
  issue("i1", { status: "in-progress", needsYou: "Failed after its fix round", headline: "✗ Failed after its fix round", agent: { id: agentIdSchema.parse("a1"), threadId: "thr_one" } }),
  issue("i2", {
    status: "in-review",
    headline: "✓ Verified: added the hello note",
    agent: { id: agentIdSchema.parse("a2"), threadId: "thr_two" },
    pr: { number: 41, url: "https://github.com/acme/notes/pull/41", state: "open", draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] },
  }),
  issue("i3", { status: "verifying", headline: "Waiting for CI on #43" }),
  issue("i4", { status: "in-progress", headline: "Working" }),
  issue("i5", { status: "todo" }),
  issue("i6", { status: "backlog", headline: "Not planned" }),
  issue("i7", { status: "done", headline: "Merged #39" }),
];

/** The board in the page it scrolls in, as the Board page and the Board tab draw it: a tab stop. */
const Page = (props: ComponentProps<typeof IssueBoard>) => createElement("div", { tabIndex: 0, "aria-label": "Board page" }, createElement(IssueBoard, props));

/** The board, with a detail standing in for the one read from the plugin; every detail drawn is recorded in `read`. */
function mount(issues: readonly IssueRow[], decisions: readonly Decision[] = [QUESTION]) {
  const read: string[] = [];
  const props = (rows: readonly IssueRow[]) => ({
    decisions,
    issues: rows,
    decisionRow: (decision: Decision, ref: (el: HTMLElement | null) => void) => createElement("p", { ref, tabIndex: -1 }, decision.question),
    detailOf: (shown: IssueRow) => {
      read.push(shown.id);
      return createElement("button", { type: "button" }, `Detail of ${shown.id}`);
    },
  });
  const view = renderSlot({ component: Page }, props(issues));
  return { view, read, reread: (rows: readonly IssueRow[]) => view.rerender(createElement(Page, props(rows))) };
}

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
  assert.equal(lane(view, /^In progress/).queryByRole("button", { name: /\bi1 Build/ }), null, "a flagged issue waits under Needs you, not in its status's lane too");

  for (const name of [/^Backlog/, /^Done/]) assert.equal(laneHeader(view, name).getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("button", { name: /\bi6 Build/ }), null);
  assert.equal(view.queryByRole("button", { name: /\bi7 Build/ }), null);
});

test("a row says what blocks it ahead of its headline, naming two and counting the rest, in its status's lane; an agent's blocked handoff stays its own headline under Needs you", () => {
  const blocked = (ids: string[]) => ids.map((each) => issueIdSchema.parse(each));
  const { view } = mount([
    issue("i1", { status: "in-progress", needsYou: "Blocked: Needs a staging key", headline: "Blocked: Needs a staging key", agent: { id: agentIdSchema.parse("a1"), threadId: "thr_one" } }),
    issue("i5", { headline: "Not started", blockedBy: blocked(["i6"]) }),
    issue("i8", { headline: "Not started", blockedBy: blocked(["i6", "i7", "i9"]) }),
    issue("i6", { headline: "Not started" }),
  ]);
  const todo = lane(view, /^Todo/);
  assert.match(todo.getByRole("button", { name: /\bi5 Build/ }).textContent ?? "", /blocked by i6Not started$/);
  assert.match(todo.getByRole("button", { name: /\bi8 Build/ }).textContent ?? "", /blocked by i6, i7 \+1Not started$/, "two named, the rest counted, on its one line");
  assert.match(row(view, "i8").getAttribute("aria-label") ?? "", /, Todo, blocked by i6, i7, and i9, Not started$/, "every blocker is spoken");
  assert.doesNotMatch(row(view, "i6").textContent ?? "", /blocked/i, "nothing blocks it, so nothing says so");

  const flagged = lane(view, /^Needs you/).getByRole("button", { name: /\bi1 Build/ });
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
  assert.ok(row(view, "i7"));
  assert.equal(document.getElementById(done.getAttribute("aria-controls") ?? "")?.tagName, "UL");

  const inReview = laneHeader(view, /^In review/);
  fireEvent.click(inReview);
  assert.equal(inReview.getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("button", { name: /\bi2 Build/ }), null);

  fireEvent.click(done);
  assert.equal(view.queryByRole("button", { name: /\bi7 Build/ }), null);
  assert.ok(document.activeElement === done, "focus stays on the header");
});

test("a row opens its detail in place under it, reading only that issue, and closes it again", () => {
  const { view, read } = mount(ISSUES);
  const todo = row(view, "i5");
  todo.focus();
  assert.equal(read.length, 0, "nothing is read before a row opens");

  fireEvent.click(todo);
  assert.equal(todo.getAttribute("aria-expanded"), "true");
  const detail = view.getByRole("region", { name: "i5" });
  assert.equal(todo.getAttribute("aria-controls"), detail.id);
  assert.ok(todo.closest("li")?.contains(detail) === true, "the detail sits under its row");
  assert.ok(within(detail).getByText("Detail of i5"));
  assert.deepEqual(read, ["i5"]);

  fireEvent.click(todo);
  assert.equal(todo.getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("region", { name: "i5" }), null);
  assert.ok(document.activeElement === todo, "focus stays on the row");
});

test("an open row whose issue moves to another lane stays open there, with focus on it", () => {
  const { view, reread } = mount(ISSUES);
  const working = row(view, "i4");
  working.focus();
  fireEvent.click(working);

  act(() => reread(ISSUES.map((each) => (each.id === "i4" ? { ...each, status: "verifying", headline: "Verifying: added it" } : each))));

  const moved = lane(view, /^Verifying/).getByRole("button", { name: /\bi4 Build/ });
  assert.equal(moved.getAttribute("aria-expanded"), "true");
  assert.ok(view.getByRole("region", { name: "i4" }));
  assert.ok(document.activeElement === moved, "focus moved with the row");
});

test("an open row shows its title and its headline whole, which it fades out at its edge while closed, and its detail doesn't repeat them", (t) => {
  const title = "Retry failed webhook deliveries with exponential backoff, capped at five attempts, and record each one";
  const headline = "Blocked: Needs a staging key for the webhook sandbox before the retry test can run against it";
  t.after(narrowRows());
  const { view } = mount([issue("i9", { status: "in-progress", needsYou: headline, headline, title })]);
  const flagged = row(view, "i9");
  const fading = (text: string) => within(flagged).getByText(text).closest("[data-over]") !== null;
  assert.deepEqual([fading(title), fading(headline)], [true, true], "closed, both run past the row and fade");

  fireEvent.click(flagged);
  assert.deepEqual([fading(title), fading(headline)], [false, false], "open, both show whole in the row");
  const detail = view.getByRole("region", { name: "i9" });
  assert.deepEqual([within(detail).queryByText(title), within(detail).queryByText(headline)], [null, null]);
  assert.equal(flagged.getAttribute("aria-label")?.split(title).length, 2, "the row speaks the title once");
});

/** Rows 300px wide, their text 7px a character, until the returned restore runs: jsdom lays nothing out, and a row fades only text that runs past it. */
function narrowRows(): () => void {
  const width = (property: "scrollWidth" | "clientWidth", of: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get(this: HTMLElement) { return of(this); } });
  width("scrollWidth", (el) => (el.textContent ?? "").length * 7);
  width("clientWidth", () => 300);
  return () => ["scrollWidth", "clientWidth"].forEach((property) => Reflect.deleteProperty(HTMLElement.prototype, property));
}

const moved = (id: string, fields: Partial<IssueRow>) => ISSUES.map((each) => (each.id === id ? { ...each, ...fields } : each));

test("a focused row whose issue moves into a folded lane hands focus to that lane's header", () => {
  const { view, reread } = mount(ISSUES);
  row(view, "i4").focus();

  act(() => reread(moved("i4", { status: "done", headline: "Merged #44" })));

  const done = laneHeader(view, /^Done/);
  assert.equal(done.getAttribute("aria-expanded"), "false");
  assert.ok(document.activeElement === done, "focus is on Done's header");
});

test("a focused row whose issue is gone from the next read hands focus to the page the board scrolls in", () => {
  const { view, reread } = mount([issue("i1", {}), issue("i2", {})], []);
  row(view, "i1").focus();

  act(() => reread([issue("i2", {})]));

  assert.equal(view.queryByRole("button", { name: /\bi1 Build/ }), null);
  assert.ok(document.activeElement === view.getByLabelText("Board page"), "focus is on the page's tab stop, not the body");
});

test("focus on a row's agent link or in its open detail moves with the issue, to its row where it lands", () => {
  const { view, reread } = mount(ISSUES);
  view.getByRole("button", { name: "Open a2's thread" }).focus();
  act(() => reread(moved("i2", { status: "verifying", headline: "Waiting for CI on #41" })));
  assert.ok(document.activeElement === lane(view, /^Verifying/).getByRole("button", { name: /\bi2 Build/ }), "from the agent link");

  fireEvent.click(row(view, "i4"));
  view.getByRole("button", { name: "Detail of i4" }).focus();
  act(() => reread(moved("i4", { status: "verifying", headline: "Verifying: added it" })));
  assert.ok(document.activeElement === lane(view, /^Verifying/).getByRole("button", { name: /\bi4 Build/ }), "from the open detail");
});

test("a row links its agent's thread and its pull request with CI, apart from opening it", () => {
  const { view, read } = mount(ISSUES);

  const pr = view.getByRole("link", { name: "Pull request 41, open, CI passing" });
  assert.equal(pr.getAttribute("href"), "https://github.com/acme/notes/pull/41");

  fireEvent.click(view.getByRole("button", { name: "Open a2's thread" }));
  assert.deepEqual(
    view.navigateCalls.map((call) => call.method === "toThread" && call.threadId),
    ["thr_two"],
  );
  assert.equal(row(view, "i2").getAttribute("aria-expanded"), "false");
  assert.deepEqual(read, []);
});

const I1 = issueIdSchema.parse("i1");
const STAGING = "Blocked: Needs a staging key";

/** A parent In progress, i1, with three sub-issues: one Done, one flagged by its agent's blocked handoff, one blocked by a dependency; and a top-level Todo. */
const SPLIT: IssueRow[] = [
  issue("i1", { title: "Card vault", status: "in-progress", subIssues: { done: 1, total: 3 }, headline: null }),
  issue("i2", { parentId: I1, status: "done", headline: "Merged #12" }),
  issue("i3", { parentId: I1, status: "in-progress", needsYou: STAGING, headline: STAGING, agent: { id: agentIdSchema.parse("a3"), threadId: "thr_three" } }),
  issue("i4", { parentId: I1, status: "todo", headline: "Not started", blockedBy: [issueIdSchema.parse("i5")] }),
  issue("i5", { status: "todo", headline: "Not started" }),
];

/** The ids of the issue rows in a list, top level only, each with the ids of the rows indented under it. */
const rowsIn = (list: HTMLElement): string[][] =>
  [...list.children].map((item) => [...item.querySelectorAll<HTMLElement>(".rmi-row")].map((button) => /^i\d+/.exec(button.getAttribute("aria-label") ?? "")?.[0] ?? "?"));

test("a parent's sub-issues sit indented under it in its lane, each with its own glyph, the parent counting them where an agent would be; a lane counts its top-level rows", () => {
  const { view } = mount(SPLIT, []);
  const headers = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  assert.deepEqual(headers, ["Needs you1", "In progress1", "Todo1"], "the parent counts once in its lane, its sub-issues by its own count");

  const working = view.getByRole("region", { name: /^In progress/ });
  assert.deepEqual(rowsIn(within(working).getAllByRole("list")[0] ?? assert.fail("no list")), [["i1", "i2", "i3", "i4"]], "all three under the parent, whatever their own status");
  const subs = within(working).getAllByRole("list")[1] ?? assert.fail("no sub-issue list");
  assert.deepEqual(
    within(subs).getAllByRole("button", { name: /^i\d Build/ }).map((button) => within(button).getByRole("img").getAttribute("aria-label")),
    ["Done", "In progress", "Todo"],
  );
  assert.match(within(subs).getByRole("button", { name: /\bi4 Build/ }).textContent ?? "", /blocked by i5/);
  const parent = row(view, "i1");
  assert.equal(parent.closest(".rmi-rowbox")?.querySelector(".rmi-sub-count")?.textContent, "1/3");
  assert.match(parent.getAttribute("aria-label") ?? "", /, In progress, 1 of 3 sub-issues done$/);
  assert.equal(lane(view, /^Todo/).queryByRole("button", { name: /\bi4 Build/ }), null, "a Todo sub-issue sits in its parent's lane, not Todo");
});

test("a parent says its count once, at the right, flagged or not; its headline says only why it is flagged", () => {
  const unmerged = "i2 isn't merged, so i1's work isn't all on the default branch";
  const { view, reread } = mount(SPLIT, []);
  const counted = () => {
    const box = row(view, "i1").closest(".rmi-rowbox") ?? assert.fail("no row box");
    return { words: row(view, "i1").textContent, count: box.querySelector(".rmi-sub-count")?.textContent, label: row(view, "i1").getAttribute("aria-label") };
  };
  assert.deepEqual(counted(), { words: "i1BuildCard vault", count: "1/3", label: "i1 Build: Card vault, In progress, 1 of 3 sub-issues done" });

  act(() => reread(SPLIT.map((each) => (each.id === "i1" ? { ...each, needsYou: unmerged, headline: unmerged } : each))));
  assert.deepEqual(counted(), { words: `i1BuildCard vault${unmerged}`, count: "1/3", label: `i1 Build: Card vault, In progress, 1 of 3 sub-issues done, ${unmerged}` });
});

test("a flagged sub-issue sits under its parent and flat under Needs you, naming its parent there; each row opens on its own", () => {
  const { view } = mount(SPLIT, []);
  const flat = lane(view, /^Needs you/).getByRole("button", { name: /\bi3 Build/ });
  assert.match(flat.getAttribute("aria-label") ?? "", /^i3 Build: Issue i3, sub-issue of i1, In progress,/);
  assert.match(flat.textContent ?? "", /^i1›i3Build/, "its parent's id and its own read as one");
  assert.ok(within(flat).getByRole("img", { name: "In progress" }), "with its own status's glyph");
  const nested = lane(view, /^In progress/).getByRole("button", { name: /\bi3 Build/ });
  assert.doesNotMatch(nested.getAttribute("aria-label") ?? "", /sub-issue of/, "under its parent it needs no name of it");

  fireEvent.click(flat);
  assert.deepEqual([flat.getAttribute("aria-expanded"), nested.getAttribute("aria-expanded")], ["true", "false"]);
  assert.equal(view.getAllByRole("region", { name: "i3" }).length, 1);
});

test("folding a parent's lane folds its sub-issues with it", () => {
  const { view } = mount(SPLIT, []);
  fireEvent.click(laneHeader(view, /^In progress/));
  assert.deepEqual(["i1", "i2", "i4"].map((id) => view.queryByRole("button", { name: new RegExp(`\\b${id} Build`) })), [null, null, null]);
  assert.ok(lane(view, /^Needs you/).getByRole("button", { name: /\bi3 Build/ }), "the flagged copy stays under Needs you");
});

test("focus on a sub-issue's row stays on it as it changes status under its parent, moves lanes with its parent, and leaves its parent for a lane of its own", () => {
  const { view, reread } = mount(SPLIT, []);
  const under = (id: string, name: RegExp) => lane(view, name).getByRole("button", { name: new RegExp(`\\b${id} Build`) });
  under("i4", /^In progress/).focus();

  act(() => reread(SPLIT.map((each) => (each.id === "i4" ? { ...each, status: "in-progress", headline: "Working", blockedBy: [] } : each))));
  assert.ok(document.activeElement === under("i4", /^In progress/), "its status changed, its row stayed");

  const reviewing = SPLIT.map((each) => (each.id === "i1" ? { ...each, status: "in-review" as const } : each));
  act(() => reread(reviewing));
  assert.ok(document.activeElement === under("i4", /^In review/), "moved with its parent, focus on its own row, not the parent's");

  act(() => reread(reviewing.map((each) => (each.id === "i4" ? { ...each, parentId: null } : each))));
  assert.ok(document.activeElement === under("i4", /^Todo/), "top-level now, in its own lane");
});

test("focus on a flagged sub-issue's row under Needs you moves to its row under its parent once its flag clears", () => {
  const { view, reread } = mount(SPLIT, []);
  lane(view, /^Needs you/).getByRole("button", { name: /\bi3 Build/ }).focus();
  act(() => reread(SPLIT.map((each) => (each.id === "i3" ? { ...each, needsYou: null, headline: "Working" } : each))));
  assert.ok(document.activeElement === lane(view, /^In progress/).getByRole("button", { name: /\bi3 Build/ }));
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
