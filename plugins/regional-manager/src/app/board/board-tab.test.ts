import "../test-browser.ts";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import { PROJECT } from "../test-sidebar.ts";

// The Board tab of a regional manager's thread as bb mounts it: its board, and its memory below it,
// which lists the files and opens one to read and edit in place.

// why: the board brings its stylesheet, which bb's build bundles and node can't load.
registerHooks({ load: (url, context, nextLoad) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context)) });
// why: jsdom has neither; the board's rows observe their size and ask for Reduce motion.
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

/** The tab of the regional manager's thread, over a plugin whose memory holds PLAN.md and records every write. */
function mount() {
  let plan = "# Plan\n\n1. Inventory the endpoints\n";
  const writes: string[] = [];
  const rpc = {
    coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }),
    board: () => ({ verify: true, ownEdits: null, prUnavailable: null, digest: null, decisions: [], issues: [] }),
    memoryList: () => ({ files: [{ file: "PLAN.md", firstLine: "1. Inventory the endpoints", modifiedAt: 1_000 }] }),
    memoryRead: () => ({ text: { content: plan, version: `v${plan.length}` }, revision: plan.length }),
    memoryWrite: (input: unknown) => {
      const { content } = contract.memoryWrite.input.parse(input);
      writes.push(content);
      plan = content;
      return { outcome: "saved", version: `v${plan.length}`, revision: plan.length };
    },
  };
  const view = renderSlot({ component: boardTab.component }, { threadId: "thr_1", projectId: PROJECT.id, environment: null }, { experimental_rpcContract: contract, rpc });
  return { view, writes };
}

test("the tab shows the board, then Memory, which lists each file with its first line and last change; opening one shows it with the way back and Edit, whose Save writes it", async () => {
  const { view, writes } = mount();
  assert.ok(await view.findByText("Verify done handoffs"), "the board");
  const memory = await view.findByRole("region", { name: /^Memory/ });
  const row = await within(memory).findByRole("button", { name: /PLAN\.md/ });
  assert.match(row.textContent ?? "", /PLAN\.md1\. Inventory the endpoints/);
  assert.ok(row.querySelector("time"));

  fireEvent.click(row);
  assert.ok(await within(memory).findByRole("heading", { level: 3, name: "PLAN.md" }));
  fireEvent.click(within(memory).getByRole("button", { name: "Edit" }));
  fireEvent.change(await within(memory).findByRole("textbox", { name: "PLAN.md" }), { target: { value: "# Plan\n\n1. Retire the cron box\n" } });
  await act(async () => fireEvent.click(within(memory).getByRole("button", { name: "Save" })));

  assert.deepEqual(writes, ["# Plan\n\n1. Retire the cron box\n"]);
  assert.equal(within(memory).queryByRole("textbox"), null, "the editor closed");
  fireEvent.click(within(memory).getByRole("button", { name: "All files" }));
  assert.ok(await within(memory).findByRole("button", { name: /PLAN\.md/ }));
});
