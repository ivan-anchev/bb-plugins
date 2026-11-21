import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { coordinatorContract as contract, memoryTag } from "../../contract.ts";
import { firstLineOf, memoryFileSchema, memoryRevisionSchema, type MemoryFile, type MemorySnapshot, type WriteOutcome } from "../../model/memory-file.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

// The board's Memory keeps each unsaved draft in the browser, so bb redrawing the panel across its
// breakpoint, or a reload, loses none, and a file deleted under a draft never hides it.

const { MemorySection } = await import("./memory-section.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const NOTES = memoryFileSchema.parse("NOTES.md");
const PREFERENCES = memoryFileSchema.parse("RULES.md");
const MINE = "# Notes\n\nUNSAVED_PLAN_MARKER\n";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

/** The memory folder on the bb server: each file's text and version, the revision each was seen at, and every write the section sent. */
function server() {
  const files = new Map<MemoryFile, { content: string; version: string; revision: number }>([
    [NOTES, { content: "# Notes\n\nNothing yet.\n", version: "v1", revision: 1 }],
    [PREFERENCES, { content: "# Preferences\n", version: "v1", revision: 1 }],
  ]);
  const writes: string[] = [];
  const snapshot = (file: MemoryFile): MemorySnapshot => {
    const stored = files.get(file);
    return stored === undefined ? { text: null, revision: memoryRevisionSchema.parse(9) } : { text: { content: stored.content, version: stored.version }, revision: memoryRevisionSchema.parse(stored.revision) };
  };
  /** Someone else writes the file, as the regional manager does. */
  const write = (file: MemoryFile, content: string): { version: string; revision: number } => {
    const revision = (files.get(file)?.revision ?? 0) + 1;
    const version = `v${revision}`;
    files.set(file, { content, version, revision });
    return { version, revision };
  };
  const rpc = {
    memoryList: () => ({ files: [...files].map(([file, { content }]) => ({ file, firstLine: firstLineOf(content), modifiedAt: 1_000 })) }),
    memoryRead: (input: unknown) => snapshot(contract.memoryRead.input.parse(input).file),
    memoryWrite: (input: unknown): WriteOutcome => {
      const { file, content, baseVersion } = contract.memoryWrite.input.parse(input);
      if ((files.get(file)?.version ?? null) !== baseVersion) return { outcome: "conflict", current: snapshot(file) };
      writes.push(`${file}: ${content}`);
      const { version, revision } = write(file, content);
      return { outcome: "saved", version, revision: memoryRevisionSchema.parse(revision) };
    },
  };
  return { rpc, writes, write, remove: (file: MemoryFile) => files.delete(file) };
}

/** The section, as the Board tab mounts it. */
function mount(rpc: ReturnType<typeof server>["rpc"], coordinatorId: CoordinatorId = COORDINATOR) {
  const view = renderSlot({ component: MemorySection }, { coordinatorId }, { experimental_rpcContract: contract, rpc });
  return {
    view,
    async editor(name: string): Promise<HTMLTextAreaElement> {
      const field = await view.findByRole("textbox", { name });
      assert.ok(field instanceof HTMLTextAreaElement);
      return field;
    },
    /** Opens the file from the list and edits it; one with a draft opens in its editor. */
    async edit(file: MemoryFile): Promise<HTMLTextAreaElement> {
      fireEvent.click(await view.findByRole("button", { name: new RegExp(`^${file}`) }));
      const edit = await view.findByRole("button", { name: /^(Edit|Save)$/ });
      if (edit.textContent === "Edit") fireEvent.click(edit);
      return this.editor(file);
    },
  };
}

test("an unsaved draft is still in its editor after the section remounts, and once saved the browser keeps none", async () => {
  const { rpc, writes } = server();
  fireEvent.change(await mount(rpc).edit(NOTES), { target: { value: MINE } });
  cleanup();

  const section = mount(rpc);
  assert.equal((await section.editor(NOTES)).value, MINE);
  await act(async () => fireEvent.click(section.view.getByRole("button", { name: "Save" })));

  assert.deepEqual(writes, [`NOTES.md: ${MINE}`]);
  assert.equal(localStorage.length, 0);
});

test("the list marks a file with a draft, and saving another file keeps that draft", async () => {
  const { rpc } = server();
  const section = mount(rpc);
  fireEvent.change(await section.edit(NOTES), { target: { value: MINE } });
  fireEvent.click(section.view.getByRole("button", { name: "All files" }));
  assert.ok(await section.view.findByRole("button", { name: /^NOTES\.md, unsaved changes/ }));
  fireEvent.change(await section.edit(PREFERENCES), { target: { value: "# Preferences\n\nMine\n" } });
  await act(async () => fireEvent.click(section.view.getByRole("button", { name: "Save" })));
  cleanup();

  const again = mount(rpc);
  fireEvent.click(await again.view.findByRole("button", { name: "All files" }));
  assert.equal((await again.edit(NOTES)).value, MINE);
});

test("a draft found after a remount over a file that moved on shows beside the newer version, and taking the newer one keeps none", async () => {
  const { rpc, write } = server();
  fireEvent.change(await mount(rpc).edit(NOTES), { target: { value: MINE } });
  cleanup();
  write(NOTES, "# Notes\n\n1. Inventory the endpoints\n");

  const section = mount(rpc);
  assert.equal((await section.editor("Your text")).value, MINE);
  assert.equal((await section.editor("Newer version")).value, "# Notes\n\n1. Inventory the endpoints\n");
  fireEvent.click(section.view.getByRole("button", { name: "Use the newer version" }));
  assert.equal(localStorage.length, 0);
});

test("a file deleted under a draft keeps it: the editor stays open, the list still names the file, and saving makes it again", async () => {
  const { rpc, remove, writes } = server();
  const section = mount(rpc);
  fireEvent.change(await section.edit(NOTES), { target: { value: MINE } });

  remove(NOTES);
  await act(() => section.view.experimental_invalidateRpc([memoryTag(COORDINATOR)]));

  assert.equal((await section.editor("Your text")).value, MINE);
  assert.match(await section.view.findByRole("alert").then((alert) => alert.textContent ?? ""), /NOTES\.md was deleted since you started editing/);
  await act(async () => fireEvent.click(section.view.getByRole("button", { name: "Save" })));
  assert.deepEqual(writes, [`NOTES.md: ${MINE}`]);
});

test("a deleted file's draft is listed after a remount, where it can be reopened", async () => {
  const { rpc, remove } = server();
  fireEvent.change(await mount(rpc).edit(NOTES), { target: { value: MINE } });
  cleanup();
  remove(NOTES);
  sessionStorage.clear();

  const section = mount(rpc);
  fireEvent.click(await section.view.findByRole("button", { name: /^NOTES\.md, unsaved changes\s*Not in the folder/ }));
  assert.equal((await section.editor("Your text")).value, MINE);
});

test("a draft is kept by regional manager, and what the browser holds that isn't drafts reads as none", async () => {
  const { rpc } = server();
  fireEvent.change(await mount(rpc).edit(NOTES), { target: { value: MINE } });
  cleanup();
  sessionStorage.clear();
  assert.equal((await mount(rpc, coordinatorIdSchema.parse("0d3b8f5e-1c2a-4e6f-8a9b-7c5d3e1f2a40")).edit(NOTES)).value, "# Notes\n\nNothing yet.\n", "another regional manager's memory has none");
  cleanup();

  for (const stored of ["{not json", JSON.stringify({ "NOTES.md": { text: 1 } }), JSON.stringify({ "../outside.md": { text: "x", base: null } })]) {
    localStorage.setItem(`coordinator-memory-drafts:${COORDINATOR}`, stored);
    sessionStorage.clear();
    assert.equal((await mount(rpc).edit(NOTES)).value, "# Notes\n\nNothing yet.\n", stored);
    cleanup();
  }
});
