import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import { PROJECT, sidebarThread } from "../test-sidebar.ts";

// The context row of a regional manager's thread names it: its icon and its name, never its description.

const { managerSegment } = await import("./manager-segment.tsx");

afterEach(cleanup);

const COORDINATOR = { id: "6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10", threadId: "thr_1", projectId: PROJECT.id, description: "Moves webhooks off cron.", avatar: { kind: "icon", icon: "Target" } };

function mount(threadId: string) {
  return renderSlot(
    { component: managerSegment.summary },
    { threadId, projectId: PROJECT.id, environment: null, segments: [], isExpanded: false, onToggle: () => {} },
    { experimental_rpcContract: contract, rpc: { coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }) }, sidebarThreads: { status: "ready", threads: [sidebarThread("thr_1", "Webhooks")], projects: [PROJECT] } },
  );
}

test("a regional manager's thread shows its icon and its name, and not its description", async () => {
  const view = mount("thr_1");

  assert.ok(await view.findByText("Webhooks"));
  assert.ok(view.container.querySelector('[data-icon="Target"]'), "its avatar");
  assert.equal(view.queryByText("Moves webhooks off cron."), null);
});

test("any other thread shows nothing", async () => {
  const view = mount("thr_other");

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(view.container.textContent, "");
});
