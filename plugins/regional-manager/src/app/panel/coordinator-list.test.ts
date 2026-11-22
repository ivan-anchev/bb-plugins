import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { PROJECT, sidebarThread } from "../test-sidebar.ts";

// The panel's list as bb mounts it: a started regional manager's row opens its thread, and the row of
// one not started yet opens its page.

const { CoordinatorList } = await import("./coordinator-list.tsx");

afterEach(cleanup);

const AVATAR = { kind: "blob", shape: "circle", hue: "violet", expression: "neutral" } as const;
const STARTED = { id: coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10"), threadId: "thr_1", projectId: PROJECT.id, description: null, avatar: AVATAR };
const WAITING = { id: coordinatorIdSchema.parse("0b9c8e5d-7a3f-4e2b-9c1d-5f6a7b8c9d0e"), name: "Scout", description: null, avatar: AVATAR };

function mount() {
  const pages: string[] = [];
  const view = renderSlot(
    { component: CoordinatorList },
    { ref: null, onOpen: (id) => void pages.push(id) },
    { experimental_rpcContract: contract, rpc: { coordinators: () => ({ coordinators: [STARTED], notStarted: [WAITING] }) }, sidebarThreads: { status: "ready", threads: [sidebarThread("thr_1", "Webhooks")], projects: [PROJECT] } },
  );
  return { view, pages };
}

test("a started regional manager's row opens its thread, not a page", async () => {
  const { view, pages } = mount();

  fireEvent.click(await view.findByRole("button", { name: "Webhooks" }));

  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]);
  assert.deepEqual(pages, []);
});

test("the row of a regional manager not started yet opens its page", async () => {
  const { view, pages } = mount();

  fireEvent.click(await view.findByRole("button", { name: "Scout" }));

  assert.deepEqual(pages, [WAITING.id]);
  assert.deepEqual(view.navigateCalls, []);
});
