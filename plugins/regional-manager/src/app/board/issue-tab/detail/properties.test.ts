import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { IssueFeed } from "../../../../contract.ts";
import type { PrSnapshot } from "../../../../model/verdict/pr.ts";
import { sidebarThread } from "../../../test-sidebar.ts";
import { agent, assignee, FEED, issue, opened, SHA } from "../test-tab.ts";

// The issue tab's head as a sheet of properties: its status, its pull request and every agent that
// held it, each its provider's mark and its id, with the working ring on one bb runs a turn of.

afterEach(cleanup);

// why here, after test-tab.ts set its own: the ring asks for Reduce motion when it first draws, and this file switches it.
let reduce = true;
Object.assign(globalThis, { matchMedia: () => ({ get matches() { return reduce; }, addEventListener() {}, removeEventListener() {} }) });

/** The animation frames asked for since the last count. */
let frames = 0;
const askFrame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => {
  frames += 1;
  return askFrame(callback);
};

/** What the ring draws through, and each arc it strokes, in degrees clockwise from 12 o'clock. */
type Drawn = Pick<CanvasRenderingContext2D, "setTransform" | "clearRect" | "beginPath" | "arc" | "stroke" | "fillRect" | "getImageData" | "lineWidth" | "lineCap" | "strokeStyle" | "fillStyle">;
const arcs: { from: number; to: number }[] = [];
const DEG = 180 / Math.PI;
const context: Drawn = {
  setTransform() {},
  clearRect() {},
  beginPath() {},
  stroke() {},
  fillRect() {},
  arc(_x, _y, _r, start, end) {
    arcs.push({ from: start * DEG + 90, to: end * DEG + 90 });
  },
  getImageData: () => ({ data: new Uint8ClampedArray([200, 200, 200, 255]), width: 1, height: 1, colorSpace: "srgb" }),
  lineWidth: 1,
  lineCap: "butt",
  strokeStyle: "",
  fillStyle: "",
};
// why defineProperty: jsdom has no canvas, and the ring draws only through what Drawn names.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => context });

const at = (hhmm: string) => Date.parse(`2026-11-25T${hhmm}:00Z`);
const PR: PrSnapshot = { forge: "github", number: 246, url: "https://github.com/ivan-anchev/bb-plugins/pull/246", state: "merged", draft: false, review: "approved", ci: "pass", headSha: SHA, failedChecks: [] };
/** BBP-76: Done with #246 merged; a68 replaced by a71 at 20:09, a71 stopped at the merge, 21:04. */
const BBP_76 = issue("BBP-76", { title: "Rounds 01: cap an issue at three failed verdicts", status: "done", headline: "Merged #246", agent: agent("a71"), pr: PR });
const BBP_76_AGENTS = [assignee("a68", "claude-code", at("20:09")), assignee("a71", "claude-code", at("21:04"))];

const feedWith = (agents: IssueFeed["agents"]) => () => ({ ...FEED, agents });
const live = (threadId: string, status: PluginSidebarThread["status"]): PluginSidebarThread => ({ ...sidebarThread(threadId, threadId), status });

const head = (tab: ReturnType<typeof within>) => within(tab.getByRole("banner"));
/** The sheet's rows: each label and what its value reads as. */
const rows = (tab: ReturnType<typeof within>) => {
  const sheet = tab.getByRole("banner").querySelector("dl") ?? assert.fail("no sheet");
  return [...sheet.querySelectorAll("dt")].map((label) => label.textContent);
};
/** The Assignee row's chips, in order. */
const chips = (tab: ReturnType<typeof within>) => {
  const label = [...tab.getByRole("banner").querySelectorAll("dt")].find((dt) => dt.textContent === "Assignee") ?? assert.fail("no Assignee row");
  return [...(label.nextElementSibling?.querySelectorAll(".rmi-assignee") ?? [])];
};

test("the head is a sheet of Status, Pull request and Assignee; BBP-76's Assignee is a71 then a68, each only its provider's mark and its id", async () => {
  const { tab } = await opened("BBP-76", [BBP_76], { feedOf: feedWith(BBP_76_AGENTS) });
  assert.deepEqual(rows(tab()), ["Status", "Pull request", "Assignee"]);
  assert.ok(head(tab()).getByRole("img", { name: "Done" }));
  assert.ok(head(tab()).getByRole("link", { name: "Pull request 246, merged, CI passing" }));

  const shown = chips(tab());
  assert.deepEqual(shown.map((chip) => chip.textContent), ["a71", "a68"], "the latest to end first, and nothing but the id in words: no model, reasoning or state");
  for (const chip of shown) {
    assert.deepEqual([...chip.children].map((child) => child.className), ["rmi-assignee-mark", "rmi-assignee-id"]);
    assert.equal(chip.querySelector("[data-provider-id]")?.getAttribute("data-provider-id"), "claude-code");
    assert.ok(chip.hasAttribute("data-earlier"), "neither holds the issue: both in subtle ink");
  }
});

test("a holder leads the agents that ended, and only the holder is drawn as holding", async () => {
  const agents = [assignee("a3", "codex", 3_000), assignee("a4", "claude-code", null), assignee("a2", "claude-code", 2_000)];
  const { tab } = await opened("WEB-1", [issue("WEB-1", { status: "in-progress" })], { feedOf: feedWith(agents) });
  const shown = chips(tab());
  assert.deepEqual(shown.map((chip) => [chip.textContent, chip.hasAttribute("data-earlier")]), [["a4", false], ["a3", true], ["a2", true]]);
});

test("a parent has no Assignee row, and no agent of its sub-issues shows anywhere in its head; an issue no agent took shows None", async () => {
  const parent = issue("WEB-1", { subIssues: { done: 0, total: 2 }, status: "in-progress" });
  const subs = [issue("WEB-2", { parentId: parent.id, agent: agent("a89"), status: "in-progress" }), issue("WEB-3", { parentId: parent.id, agent: agent("a90"), status: "in-progress" })];
  const { tab } = await opened("WEB-1", [parent, ...subs], { feedOf: feedWith([]), live: [live("thr_a89", "active")] });
  assert.deepEqual(rows(tab()), ["Status"]);
  const banner = tab().getByRole("banner");
  assert.equal(banner.querySelector(".rmi-assignee, [data-provider-id], canvas"), null);
  assert.doesNotMatch(banner.textContent ?? "", /a89|a90/);
  cleanup();

  const { tab: unstarted } = await opened("WEB-4", [issue("WEB-4", {})], { feedOf: feedWith([]) });
  assert.deepEqual(rows(unstarted()), ["Status", "Assignee"]);
  assert.deepEqual(chips(unstarted()), []);
  assert.ok(head(unstarted()).getByText("None"));
});

test("a chip is a tab stop naming its id, provider and whether it works, and opens its thread; one whose thread is gone is no button", async () => {
  const agents = [assignee("a7", "claude-code", 1_000), assignee("a8", "codex", 2_000), assignee("a9", "claude-code", null)];
  const deleted: IssueFeed["agents"][number] = { ...assignee("a7", "claude-code", 1_000), threadId: null };
  const { view, tab } = await opened("WEB-1", [issue("WEB-1", { status: "in-progress" })], { feedOf: feedWith([deleted, ...agents.slice(1)]), live: [live("thr_a9", "active"), live("thr_a8", "idle")] });
  const buttons = head(tab()).getAllByRole("button");
  assert.deepEqual(
    buttons.map((button) => [button.getAttribute("aria-label"), button.tabIndex]),
    [
      ["a9, Claude Code, working. Open its thread", 0],
      ["a8, Codex, not working. Open its thread", 0],
    ],
  );
  fireEvent.click(head(tab()).getByRole("button", { name: "a8, Codex, not working. Open its thread" }));
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_a8" }]);

  const gone = chips(tab()).at(-1) ?? assert.fail("no chip");
  assert.deepEqual([gone.tagName, gone.getAttribute("aria-label"), gone.textContent], ["SPAN", "a7, Claude Code, not working", "a7"]);
  assert.equal(gone.closest("button"), null);
});

test("an agent bb runs a turn of has the ring and one at rest has none; an unknown status counts as at rest", async () => {
  reduce = false;
  frames = 0;
  // why off-type: a status newer than this SDK, as bb may send one.
  const newer = { ...live("thr_a3", "idle"), status: "compacting" } as unknown as PluginSidebarThread;
  const agents = [assignee("a1", "claude-code", 1_000), assignee("a2", "claude-code", 2_000), assignee("a3", "claude-code", 3_000), assignee("a4", "claude-code", null)];
  const { tab } = await opened("WEB-1", [issue("WEB-1", { status: "in-progress" })], { feedOf: feedWith(agents), live: [live("thr_a4", "starting"), live("thr_a2", "idle"), live("thr_a1", "stopping"), newer] });
  const ringed = chips(tab()).map((chip) => [chip.textContent, chip.querySelector("canvas.rmi-assignee-ring") !== null]);
  assert.deepEqual(ringed, [["a4", true], ["a3", false], ["a2", false], ["a1", true]]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(frames > 1, `the ring turns on animation frames: ${frames} asked`);
});

test("with Reduce motion the ring asks for no animation frame and rests on eight even dashes", async () => {
  reduce = true;
  frames = 0;
  arcs.length = 0;
  const { tab } = await opened("WEB-1", [issue("WEB-1", { status: "in-progress" })], { feedOf: feedWith([assignee("a1", "claude-code", null)]), live: [live("thr_a1", "active")] });
  assert.ok(chips(tab())[0]?.querySelector("canvas.rmi-assignee-ring"), "it still shows the agent at work");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(frames, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  assert.deepEqual(
    arcs.map(({ from, to }) => [round(from), round(to)]),
    Array.from({ length: 8 }, (_, i) => [round(45 * i - 10.95), round(45 * i + 10.95)]),
  );
});
