import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import { memoryFileSchema, memoryRevisionSchema, type MemoryFile, type MemorySnapshot, type WriteOutcome } from "../../model/memory-file.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

// QA-01: bb redrawing the panel across its breakpoint, or a reload, remounted the Memory page and
// dropped every unsaved edit. The page keeps each draft in the browser instead, until it is saved
// or the user takes the newer version.

const { MemoryPage } = await import("./memory-page.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const PLAN = memoryFileSchema.parse("PLAN.md");
const PREFERENCES = memoryFileSchema.parse("PREFERENCES.md");
const MINE = "# Plan\n\nUNSAVED_PLAN_MARKER\n";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

/** The memory folder on the bb server: each file's text and version, the revision each was seen at, and every write the page sent. */
function server() {
  const files = new Map<MemoryFile, { content: string; version: string; revision: number }>([
    [PLAN, { content: "# Plan\n\nNo plan yet.\n", version: "v1", revision: 1 }],
    [PREFERENCES, { content: "# Preferences\n", version: "v1", revision: 1 }],
  ]);
  const writes: string[] = [];
  const snapshot = (file: MemoryFile): MemorySnapshot => {
    const stored = files.get(file);
    return stored === undefined ? { text: null, revision: memoryRevisionSchema.parse(0) } : { text: { content: stored.content, version: stored.version }, revision: memoryRevisionSchema.parse(stored.revision) };
  };
  /** Someone else writes the file, as the regional manager does. */
  const write = (file: MemoryFile, content: string): { version: string; revision: number } => {
    const revision = (files.get(file)?.revision ?? 0) + 1;
    const version = `v${revision}`;
    files.set(file, { content, version, revision });
    return { version, revision };
  };
  const rpc = {
    coordinators: () => ({ coordinators: [] }),
    memoryList: () => ({ dir: "/memory", files: [...files.keys()] }),
    memoryRead: (input: unknown) => snapshot(contract.memoryRead.input.parse(input).file),
    memoryWrite: (input: unknown): WriteOutcome => {
      const { file, content, baseVersion } = contract.memoryWrite.input.parse(input);
      if ((files.get(file)?.version ?? null) !== baseVersion) return { outcome: "conflict", current: snapshot(file) };
      writes.push(`${file}: ${content}`);
      const { version, revision } = write(file, content);
      return { outcome: "saved", version, revision: memoryRevisionSchema.parse(revision) };
    },
  };
  return { rpc, writes, write };
}

/** The Memory page, as bb mounts it, with the file the user opens. */
function mount(rpc: ReturnType<typeof server>["rpc"], coordinatorId: CoordinatorId = COORDINATOR) {
  const view = renderSlot({ component: MemoryPage }, { ref: null, coordinatorId, onBack: () => {} }, { rpc });
  return {
    view,
    async editor(name: string): Promise<HTMLTextAreaElement> {
      const field = await view.findByRole("textbox", { name });
      assert.ok(field instanceof HTMLTextAreaElement);
      return field;
    },
    async open(file: MemoryFile): Promise<void> {
      fireEvent.click(await view.findByRole("button", { name: new RegExp(`^${file}`) }));
    },
  };
}

test("an unsaved draft is still in the editor after the page remounts, and once saved the browser keeps none", async () => {
  const { rpc, writes } = server();
  fireEvent.change(await mount(rpc).editor(PLAN), { target: { value: MINE } });
  cleanup();

  const page = mount(rpc);
  assert.equal((await page.editor(PLAN)).value, MINE);
  assert.ok(page.view.getByRole("button", { name: "PLAN.md, unsaved changes" }), "the file list marks it");
  await act(async () => fireEvent.click(page.view.getByRole("button", { name: "Save" })));

  assert.deepEqual(writes, [`PLAN.md: ${MINE}`]);
  assert.equal(localStorage.length, 0);
});

test("saving one file keeps the other file's draft", async () => {
  const { rpc } = server();
  const page = mount(rpc);
  fireEvent.change(await page.editor(PLAN), { target: { value: MINE } });
  await page.open(PREFERENCES);
  fireEvent.change(await page.editor(PREFERENCES), { target: { value: "# Preferences\n\nMine\n" } });
  await act(async () => fireEvent.click(page.view.getByRole("button", { name: "Save" })));
  cleanup();

  const again = mount(rpc);
  await again.open(PLAN);
  assert.equal((await again.editor(PLAN)).value, MINE);
});

test("a draft found after a remount over a file that moved on shows beside the newer version, and taking the newer one keeps none", async () => {
  const { rpc, write } = server();
  fireEvent.change(await mount(rpc).editor(PLAN), { target: { value: MINE } });
  cleanup();
  write(PLAN, "# Plan\n\n1. Inventory the endpoints\n");

  const page = mount(rpc);
  assert.equal((await page.editor("Your text")).value, MINE);
  assert.equal((await page.editor("Newer version")).value, "# Plan\n\n1. Inventory the endpoints\n");
  fireEvent.click(page.view.getByRole("button", { name: "Use the newer version" }));
  assert.equal(localStorage.length, 0);
});

test("a draft is kept by Coordinator, and what the browser holds that isn't drafts reads as none", async () => {
  const { rpc } = server();
  fireEvent.change(await mount(rpc).editor(PLAN), { target: { value: MINE } });
  cleanup();
  assert.equal((await mount(rpc, coordinatorIdSchema.parse("0d3b8f5e-1c2a-4e6f-8a9b-7c5d3e1f2a40")).editor(PLAN)).value, "# Plan\n\nNo plan yet.\n", "another Coordinator's memory has none");
  cleanup();

  for (const stored of ["{not json", JSON.stringify({ "PLAN.md": { text: 1 } }), JSON.stringify({ "../outside.md": { text: "x", base: null } })]) {
    localStorage.setItem(`coordinator-memory-drafts:${COORDINATOR}`, stored);
    assert.equal((await mount(rpc).editor(PLAN)).value, "# Plan\n\nNo plan yet.\n", stored);
    cleanup();
  }
});
