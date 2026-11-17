import "../../test-browser.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createElement } from "react";
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
  return { id: issueIdSchema.parse(id), kind: "build", title: `Issue ${id}`, status: "todo", needsYou: null, headline: "Planned", agent: null, pr: null, ...fields };
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

/** The board, with a detail standing in for the one read from the plugin; every detail drawn is recorded in `read`. */
function mount(issues: readonly IssueRow[], decisions: readonly Decision[] = [QUESTION]) {
  const read: string[] = [];
  const props = (rows: readonly IssueRow[]) => ({
    decisions,
    issues: rows,
    decisionRow: (decision: Decision, ref: (el: HTMLElement | null) => void) => createElement("p", { ref, tabIndex: -1 }, decision.question),
    detailOf: (shown: IssueRow) => {
      read.push(shown.id);
      return createElement("p", null, `Detail of ${shown.id}`);
    },
  });
  const view = renderSlot({ component: IssueBoard }, props(issues));
  return { view, read, reread: (rows: readonly IssueRow[]) => view.rerender(createElement(IssueBoard, props(rows))) };
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
  const detail = view.getByRole("region", { name: "i5: Issue i5" });
  assert.equal(todo.getAttribute("aria-controls"), detail.id);
  assert.ok(todo.closest("li")?.contains(detail) === true, "the detail sits under its row");
  assert.ok(within(detail).getByText("Detail of i5"));
  assert.deepEqual(read, ["i5"]);

  fireEvent.click(todo);
  assert.equal(todo.getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("region", { name: "i5: Issue i5" }), null);
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
  assert.ok(view.getByRole("region", { name: "i4: Issue i4" }));
  assert.ok(document.activeElement === moved, "focus moved with the row");
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
