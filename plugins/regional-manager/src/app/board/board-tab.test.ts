import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, within } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import { PROJECT } from "../test-sidebar.ts";

Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});

const { boardTab } = await import("./board-tab.tsx");

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

const COORDINATOR = { id: "6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10", threadId: "thr_1", projectId: PROJECT.id, description: null, avatar: { kind: "icon", icon: "Workflow" } };

function mount() {
  const rpc = {
    coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }),
    board: () => ({ verify: true, ownEdits: null, prUnavailable: null, decisions: [], issues: [] }),
    memoryList: () => ({ files: [{ file: "NOTES.md", preview: "# Notes\n\n1. Inventory the endpoints\n", modifiedAt: 1_000 }] }),
  };
  return renderSlot({ component: boardTab.component }, { threadId: "thr_1", projectId: PROJECT.id, environment: null }, { experimental_rpcContract: contract, rpc });
}

test("the tab shows the board, then Memory below it, which shows each file as a card previewing its text", async () => {
  const view = mount();
  const board = await view.findByText("Verify done handoffs");
  const memory = await view.findByRole("region", { name: /^Memory/ });
  assert.ok(board.compareDocumentPosition(memory) & Node.DOCUMENT_POSITION_FOLLOWING, "Memory comes after the board");
  const card = await within(memory).findByRole("button", { name: /^NOTES\.md/ });
  assert.match(card.textContent ?? "", /1\. Inventory the endpoints/);
});
