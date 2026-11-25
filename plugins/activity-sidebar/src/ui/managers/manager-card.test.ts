import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup } from "@testing-library/react";
import { DWELL } from "../../card/card-intent.ts";
import { activitySidebarContract } from "../../contract.ts";
import { buildActivity } from "../../model/activity.ts";
import { AVATAR, OPEN_ISSUES, project, thread, WORKING } from "../../model/fixtures.ts";
import type { ManagerIssues } from "../../model/manager-issues.ts";

// A manager's hover card as the Managers view shows it, with the list its server read answers: what it
// says, and what it leaves out.

const { SidebarViews } = await import("./sidebar-views.tsx");

afterEach(cleanup);

const THREADS = [thread("thr_pr", { originPluginId: "regional-manager", createdAt: 1, displayTitle: "PR Reviews", projectId: "prj_a", ...WORKING })];
const LOOK = { id: "mgr_1", threadId: "thr_pr", description: "Reviews every open pull request.", avatar: AVATAR };

/** The Managers view with the card resting open on PR Reviews; `issues` answers its open work read. */
async function openCard(issues: () => Record<string, ManagerIssues | null>, look: typeof LOOK | null = LOOK) {
  const reads: unknown[] = [];
  const { managers } = buildActivity({ threads: THREADS, projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), held: new Set(), now: 0, activeThreadId: null, filter: null, looks: look === null ? [] : [look], lines: [] });
  const slot = renderSlot(
    { component: SidebarViews },
    { managers, underWaySince: new Map([["thr_pr", Date.now()]]), view: "managers", onView: () => {}, onNavigate: () => {}, threads: null },
    {
      experimental_rpcContract: activitySidebarContract,
      rpc: {
        managerIssues: (input) => {
          reads.push(input);
          return issues();
        },
      },
    },
  );
  act(() => slot.getByRole("link", { name: /^PR Reviews/ }).focus());
  await act(() => wait(DWELL + 50));
  const card = document.querySelector<HTMLElement>(".as-card");
  assert.ok(card, "its card shows");
  return { card, reads };
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null;
/** A heading's parts, its words and its count, which CSS sets apart. */
const parts = (el: Element) => Array.from(el.childNodes, (node) => node.textContent).join(" ");

test("the card says the manager's name, description, state and project, then Needs you and In progress, each heading words and a count only", async () => {
  const { card, reads } = await openCard(() => OPEN_ISSUES);
  assert.equal(text(card.querySelector(".as-card-title")), "PR Reviews");
  assert.ok(card.querySelector(".as-card-head .as-avatar"), "its avatar leads its name");
  assert.equal(text(card.querySelector(".as-card-desc")), "Reviews every open pull request.");
  assert.deepEqual(
    Array.from(card.querySelectorAll(".as-card-line"), (line) => text(line)),
    ["Working · for under a minute", "bb-plugins"],
    "its state and project; no machine, branch or pull request",
  );
  const heads = Array.from(card.querySelectorAll(".as-card-sub-head"));
  assert.deepEqual(
    heads.map(parts),
    ["Needs you 2", "In progress 1"],
  );
  assert.ok(
    heads.every((head) => head.querySelector("svg") === null),
    "no glyph in a heading",
  );
  assert.equal(card.querySelector(".as-mini-mark"), null, "no subthread tree");
  assert.deepEqual(reads, [{ keys: ["mgr_1"] }], "read when the card opens, by the manager's id");
});

test("each issue opens its tab in the manager's thread; a sub-issue hangs under its parent, shown as quiet context; the decision opens the Board", async () => {
  const { card } = await openCard(() => OPEN_ISSUES);
  const lines = Array.from(card.querySelectorAll<HTMLElement>(".as-mini"));
  assert.deepEqual(
    lines.map((line) => [line.querySelector("a")?.getAttribute("aria-label"), line.querySelector("a")?.getAttribute("href"), line.hasAttribute("data-context") ? "context" : null, line.querySelector(".as-mini-rails") === null ? null : "nested"]),
    [
      ["Ship on Friday?, needs your answer on the Board", "/projects/prj_a/threads/thr_pr", null, null],
      ["WEB-4 Webhook schema, Todo", "/plugins/regional-manager/regional-managers/issue/mgr_1/WEB-4", "context", null],
      ["WEB-5 Schema version, Needs you: Blocked: which schema version?", "/plugins/regional-manager/regional-managers/issue/mgr_1/WEB-5", null, "nested"],
      ["WEB-2 Retry queue, Reviewing", "/plugins/regional-manager/regional-managers/issue/mgr_1/WEB-2", null, null],
    ],
  );
  assert.equal(lines[2]?.querySelector(".as-issue-state")?.getAttribute("data-state"), "needs-you", "a flagged sub-issue wears Needs you's mark");
});

test("past eight lines, a plain '+N more' that is neither a link, a button nor a tab stop", async () => {
  const underWay = Array.from({ length: 11 }, (_, i) => ({ id: `WEB-${i + 1}`, title: `Issue ${i + 1}`, status: "in-progress" as const, parentId: null }));
  const { card } = await openCard(() => ({ mgr_1: { needsYou: [], underWay, parents: [], decisions: [] } }));
  assert.equal(card.querySelectorAll(".as-mini").length, 8);
  const more = card.querySelector<HTMLElement>(".as-card-more");
  assert.equal(text(more), "+3 more");
  assert.equal(more?.closest("a, button"), null);
  assert.equal(more?.querySelector("a, button, [tabindex]"), null);
  assert.equal(more?.hasAttribute("tabindex"), false);
});

test("a manager with nothing waiting on the user and nothing under way: no rule, no list, no words in their place", async () => {
  const { card } = await openCard(() => ({ mgr_1: { needsYou: [], underWay: [], parents: [], decisions: [] } }));
  assert.equal(card.querySelector(".as-card-body"), null);
  assert.equal(card.querySelector(".as-card-rule"), null);
  assert.deepEqual(
    Array.from(card.querySelectorAll(".as-card-line"), (line) => text(line)),
    ["Working · for under a minute", "bb-plugins"],
  );
});

test("a failed read of the manager's open work, or one the server couldn't read, leaves the card without its list", async () => {
  for (const issues of [() => ({ mgr_1: null }), () => assert.fail("the read failed")]) {
    const { card } = await openCard(issues);
    await act(() => wait(0));
    assert.equal(text(card.querySelector(".as-card-title")), "PR Reviews");
    assert.equal(card.querySelector(".as-card-body"), null);
    cleanup();
  }
});

test("a manager whose look is unknown shows no description and no list, and reads nothing", async () => {
  const { card, reads } = await openCard(() => OPEN_ISSUES, null);
  assert.equal(card.querySelector(".as-card-desc"), null);
  assert.equal(card.querySelector(".as-card-body"), null);
  assert.deepEqual(reads, []);
});
