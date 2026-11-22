import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor } from "@testing-library/react";
import { coordinatorContract as contract, type Coordinator } from "../../contract.ts";
import { coordinatorIdSchema } from "../../model/role.ts";

// An issue link followed where no overlay caught it lands on the panel's page for it, which opens its
// regional manager's thread, where the thread's pane opens the issue's tab (issue-links.test.ts); or
// says why it can't.

const { CoordinatorPanel } = await import("../panel/coordinator-panel.tsx");

afterEach(cleanup);

const COORDINATOR: Coordinator = { id: coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10"), threadId: "thr_manager", projectId: "prj_1", description: null, avatar: { kind: "icon", icon: "Workflow" } };

const land = (coordinators: Coordinator[]) =>
  renderSlot({ component: CoordinatorPanel }, { subPath: `issue/${COORDINATOR.id}/BBP-24` }, { experimental_rpcContract: contract, rpc: { coordinators: () => ({ coordinators, notStarted: [] }) } });

test("an issue link's page opens its regional manager's thread, once, and Back from the thread leads past the page, to the list", async () => {
  const view = land([COORDINATOR]);
  await view.findByText("BBP-24 opens in its regional manager's thread.");
  await waitFor(() => assert.ok(view.inspection.navigateCalls.some(({ method }) => method === "toThread")));
  const history = historyAfter(["thread thr_chat", `panel regional-managers/issue/${COORDINATOR.id}/BBP-24`], view.inspection.navigateCalls);
  assert.deepEqual(history.slice(-2), ["panel regional-managers/", "thread thr_manager"], "Back from the manager's thread is the list, which opens nothing; it was the link's page, which opened the thread again");
  assert.equal(history.length, 3, "and Back from the list is where the link was followed from");
});

/**
 * bb's history, `entries` oldest first, after the navigation `calls`, as bb's navigate documents it:
 * opening a thread adds an entry, and so does opening a panel, unless it replaces the current one.
 */
function historyAfter(entries: readonly string[], calls: ReturnType<typeof land>["inspection"]["navigateCalls"]): string[] {
  return calls.reduce<string[]>((history, call) => {
    if (call.method === "toThread") return [...history, `thread ${call.threadId}`];
    if (call.method !== "toPluginPanel") return assert.fail(`unexpected ${call.method}`);
    const entry = `panel ${call.path}/${call.options?.subPath ?? ""}`;
    return call.options?.replace === true ? [...history.slice(0, -1), entry] : [...history, entry];
  }, [...entries]);
}

test("a link whose regional manager is gone says so, and leads to the list", async () => {
  const view = land([]);
  await view.findByText(/BBP-24's regional manager was deleted\./);
  (await view.findByRole("button", { name: "See every regional manager" })).click();
  assert.deepEqual(view.inspection.navigateCalls, [{ method: "toPluginPanel", path: "regional-managers" }]);
});
