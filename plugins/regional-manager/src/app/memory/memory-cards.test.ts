import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

// The board's Memory as cards: each file previews the start of its text, named under it with its
// folder, all from the one list read, opening with focus on the way back and returning it to the
// card; and the section folds from its header, staying folded through a remount, as a reload does.

/** Each card scrolled into view, by its name, with how. */
const scrolls: { card: string; options: ScrollIntoViewOptions | boolean | undefined }[] = [];
Element.prototype.scrollIntoView = function (this: Element, options) {
  scrolls.push({ card: this.querySelector(".rmi-memory-card-file")?.textContent ?? "", options });
};

const { MemorySection } = await import("./memory-section.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");

afterEach(() => {
  scrolls.length = 0;
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

/** A memory folder of a root file and a report in a subfolder, counting each file the section reads one by one. */
function server() {
  const reads: string[] = [];
  const rpc = {
    memoryList: () => ({
      files: [
        { file: "NOTES.md", preview: "# Working plan\n\nInventory the endpoints, then retire cron.\n", modifiedAt: 1_000 },
        { file: "reports/i3.md", preview: "# Outcome\n\nPrepared the exploration checklist.\n", modifiedAt: 2_000 },
      ],
    }),
    memoryRead: (input: unknown) => {
      reads.push(contract.memoryRead.input.parse(input).file);
      return { text: { content: "# Working plan\n", version: "v1" }, revision: 1 };
    },
  };
  return { rpc, reads };
}

function mount(rpc: ReturnType<typeof server>["rpc"], coordinatorId: CoordinatorId = COORDINATOR) {
  return renderSlot({ component: MemorySection }, { coordinatorId }, { experimental_rpcContract: contract, rpc });
}

test("each file is a card previewing its text, named under it, a file in a subfolder with its folder, all from the one list read; opening one and going back keeps focus", async () => {
  const { rpc, reads } = server();
  const view = mount(rpc);

  const notes = await view.findByRole("button", { name: "NOTES.md" });
  assert.match(within(notes).getByTestId("bb-markdown").textContent ?? "", /^# Working plan\n\nInventory the endpoints, then retire cron\.\n$/);

  const report = view.getByRole("button", { name: /^i3\.md\s*in\s*reports$/ });
  assert.match(within(report).getByTestId("bb-markdown").textContent ?? "", /^# Outcome\n\nPrepared the exploration checklist\.\n$/);
  assert.deepEqual(reads, [], "no card reads its file");

  fireEvent.click(report);
  assert.ok(await view.findByRole("button", { name: "Edit" }));
  assert.deepEqual(reads, ["reports/i3.md"], "the opened file is read whole");
  assert.equal(document.activeElement, view.getByRole("button", { name: "All files" }), "focus lands on the way back, not the page");
  fireEvent.click(view.getByRole("button", { name: "All files" }));
  assert.equal(document.activeElement, view.getByRole("button", { name: /^i3\.md\s*in\s*reports$/ }), "and back on the file's card");
});

test("the header folds Memory, hiding its files, and it is still folded when mounted again, until it is unfolded", async () => {
  const { rpc } = server();
  const view = mount(rpc);
  const header = await view.findByRole("button", { name: /^Memory\s*2/ });
  assert.equal(header.getAttribute("aria-expanded"), "true");
  assert.ok(view.getByRole("button", { name: /^NOTES\.md/ }));

  fireEvent.click(header);
  assert.equal(header.getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("button", { name: /^NOTES\.md/ }), null, "folded, no file shows");
  cleanup();

  assert.equal(await expanded(mount(rpc, coordinatorIdSchema.parse("0d3b8f5e-1c2a-4e6f-8a9b-7c5d3e1f2a40"))), "true", "another regional manager's Memory is open");
  cleanup();

  const again = mount(rpc);
  assert.equal(await expanded(again), "false", "still folded");
  assert.equal(again.queryByRole("button", { name: /^NOTES\.md/ }), null);
  fireEvent.click(again.getByRole("button", { name: /^Memory/ }));
  assert.ok(again.getByRole("button", { name: /^NOTES\.md/ }));
  cleanup();

  assert.equal(await expanded(mount(rpc)), "true", "unfolded, it stays open");
});

test("a card that takes focus, as Tab gives it, scrolls wholly into the row and the board's view", async () => {
  const { rpc } = server();
  const view = mount(rpc);
  const report = await view.findByRole("button", { name: /^i3\.md\s*in\s*reports$/ });
  assert.deepEqual(scrolls, []);

  act(() => report.focus());
  assert.deepEqual(scrolls, [{ card: "i3.md", options: { block: "nearest", inline: "nearest" } }]);
});

/** Whether the section's header shows it open. */
async function expanded(view: ReturnType<typeof mount>): Promise<string | null> {
  return (await view.findByRole("button", { name: /^Memory/ })).getAttribute("aria-expanded");
}
