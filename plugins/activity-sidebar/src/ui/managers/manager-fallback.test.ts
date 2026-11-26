import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { buildActivity } from "../../model/activity.ts";
import { COORDINATORS, MALFORMED_COORDINATORS, project, thread } from "../../model/fixtures.ts";
import { openManagerLooks } from "../../server/managers/manager-looks.ts";

// From the Regional Manager plugin's answer to the Managers view's rows: what each manager shows when
// that answer is good, and that it falls back to its name and a plain avatar
// whenever the answer fails or comes in a shape the sidebar doesn't know, even after a good one.

const { SidebarViews } = await import("./sidebar-views.tsx");

const NO_OPTIONS = { managers: null, threads: null };

afterEach(cleanup);

const THREADS = [
  thread("thr_pr", { originPluginId: "regional-manager", createdAt: 1, displayTitle: "PR Reviews" }),
  thread("thr_sb", { originPluginId: "regional-manager", createdAt: 2, displayTitle: "Sidebar" }),
];

/** The looks read, answering `answer()` each time; bb's callRpc parses with the caller's schema. */
function looksRead(answer: () => Promise<unknown>) {
  return openManagerLooks({
    plugins: { callRpc: async ({ outputSchema }) => outputSchema.parse(await answer()) },
    threads: { get: async () => ({ originPluginId: null, parentThreadId: null }), list: async ({ threadIds }) => threadIds.map((id) => ({ id })) },
    rpc: { experimental_invalidate: () => {} },
    log: { warn: () => {} },
  });
}

/** Each manager's row as the Managers view renders it from one read. */
async function rowsAfter(read: ReturnType<typeof looksRead>) {
  const { looks } = await read.read();
  const { managers } = buildActivity({ threads: THREADS, projects: [project("prj_a", "bb-plugins")], sleeps: new Map(), held: new Set(), now: 0, activeThreadId: null, filter: null, looks, lines: [] });
  const slot = renderSlot({ component: SidebarViews }, { managers, underWaySince: null, view: "managers", onView: () => {}, onNavigate: () => {}, managersCompact: false, options: NO_OPTIONS, threads: () => null });
  const rows = Array.from(slot.container.querySelectorAll<HTMLElement>(".as-manager")).map((row) => ({
    name: row.querySelector(".as-title-text")?.textContent,
    avatar: row.querySelector(".as-avatar-plain") !== null ? "plain" : row.querySelector("svg") !== null ? "blob" : "none",
  }));
  cleanup();
  return rows;
}

const FALLBACK = [
  { name: "PR Reviews", avatar: "plain" },
  { name: "Sidebar", avatar: "plain" },
];

test("a good answer draws each manager's blob avatar and name", async () => {
  assert.deepEqual(await rowsAfter(looksRead(async () => COORDINATORS)), [
    { name: "PR Reviews", avatar: "blob" },
    { name: "Sidebar", avatar: "blob" },
  ]);
});

test("the read failing, first or after a good answer, leaves each manager its name and a plain avatar", async () => {
  let fail = true;
  const read = looksRead(async () => {
    if (fail) throw new Error('plugin "regional-manager" is not installed');
    return COORDINATORS;
  });
  assert.deepEqual(await rowsAfter(read), FALLBACK, "before any good answer");
  fail = false;
  assert.equal((await rowsAfter(read))[0].avatar, "blob");
  fail = true;
  assert.deepEqual(await rowsAfter(read), FALLBACK, "after a good answer");
});

test("an answer in a shape the sidebar doesn't know, first or after a good one, leaves each manager its name and a plain avatar", async () => {
  for (const malformed of MALFORMED_COORDINATORS) {
    let answer: unknown = malformed;
    const read = looksRead(async () => answer);
    assert.deepEqual(await rowsAfter(read), FALLBACK, `before any good answer: ${JSON.stringify(malformed).slice(0, 80)}`);
    answer = COORDINATORS;
    assert.equal((await rowsAfter(read))[0].avatar, "blob");
    answer = malformed;
    assert.deepEqual(await rowsAfter(read), FALLBACK, `after a good answer: ${JSON.stringify(malformed).slice(0, 80)}`);
  }
});
