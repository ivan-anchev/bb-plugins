import "../test-browser.ts";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { COORDINATORS_TAG, coordinatorContract as contract, type Coordinator, type NotStarted } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { PROJECT, sidebarThread } from "../test-sidebar.ts";

// A regional manager's page in the panel as bb mounts it: its profile above its board and its
// memory once started, its name from bb's thread list, the rest from the plugin; before the start,
// above bb's composer, whose message starts it. Edit opens the profile in place and saves it whole.

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

const { BoardPage } = await import("./board-page.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const PLAN = "# Plan\n\n1. Inventory the endpoints\n";

/**
 * The page over a plugin holding one regional manager, started or not, which keeps every profile it
 * is sent, as setProfile does but for a started one's title, which bb keeps; its memory holds PLAN.md.
 */
function mount({ started = true }: { started?: boolean } = {}) {
  const profileOf = { description: "Moves webhooks off cron.", avatar: { kind: "icon", icon: "Workflow" } } as const;
  let stored: Coordinator = { id: COORDINATOR, threadId: "thr_1", projectId: PROJECT.id, ...profileOf };
  let waiting: NotStarted | null = started ? null : { id: COORDINATOR, name: "Scout", ...profileOf };
  const saves: Profile[] = [];
  const calls: { method: string; input: unknown }[] = [];
  let plan = PLAN;
  const rpc = {
    coordinators: () => ({ coordinators: waiting === null ? [stored] : [], notStarted: waiting === null ? [] : [waiting] }),
    board: () => ({ verify: true, ownEdits: null, prUnavailable: null, digest: null, decisions: [], issues: [] }),
    primaryHost: () => ({ hostId: "host_1" }),
    setProfile: (input: unknown) => {
      const { profile } = contract.setProfile.input.parse(input);
      saves.push(profile);
      stored = { ...stored, description: profile.description, avatar: profile.avatar };
      if (waiting !== null) waiting = { ...waiting, ...profile };
      return {};
    },
    startCoordinator: (input: unknown) => {
      calls.push({ method: "startCoordinator", input: contract.startCoordinator.input.parse(input) });
      return { threadId: "thr_9" };
    },
    deleteCoordinator: (input: unknown) => {
      calls.push({ method: "deleteCoordinator", input: contract.deleteCoordinator.input.parse(input) });
      waiting = null;
      return {};
    },
    memoryList: () => ({ files: [{ file: "PLAN.md", firstLine: "1. Inventory the endpoints", modifiedAt: 1_000 }] }),
    memoryRead: () => ({ text: { content: plan, version: `v${plan.length}` }, revision: plan.length }),
    memoryWrite: (input: unknown) => {
      const { content } = contract.memoryWrite.input.parse(input);
      calls.push({ method: "memoryWrite", input: content });
      plan = content;
      return { outcome: "saved", version: `v${plan.length}`, revision: plan.length };
    },
  };
  const backs: string[] = [];
  const view = renderSlot(
    { component: BoardPage },
    { ref: null, coordinatorId: COORDINATOR, onBack: () => void backs.push("back") },
    { experimental_rpcContract: contract, rpc, sidebarThreads: { status: "ready", threads: [sidebarThread("thr_1", "Webhooks")], projects: [PROJECT] } },
  );
  return { view, saves, calls, backs };
}

test("the page's heading is the regional manager's name, with its description", async () => {
  const { view } = mount();

  assert.equal((await view.findByRole("heading", { level: 1 })).textContent, "Board of Webhooks");
  assert.ok(view.getByText("Moves webhooks off cron."));
});

test("Edit opens the profile in place on the name, and Save sends the changed name, description and icon, then closes it with the focus back on Edit", async () => {
  const { view, saves } = mount();
  const edit = await view.findByRole("button", { name: "Edit" });
  // why focus first: a click focuses the button in a browser, and jsdom's doesn't.
  edit.focus();
  fireEvent.click(edit);
  const name = view.getByRole("textbox", { name: "Name" });
  assert.ok(document.activeElement === name, "the focus Edit had moves to the name");

  fireEvent.change(name, { target: { value: "Webhooks v2" } });
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), { target: { value: "Retries too." } });
  fireEvent.click(view.getByRole("radio", { name: "Brain" }));
  view.getByRole("button", { name: "Save" }).focus();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  await act(() => view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.deepEqual(saves, [{ name: "Webhooks v2", description: "Retries too.", avatar: { kind: "icon", icon: "Brain" } }]);
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
  assert.ok(document.activeElement === view.getByRole("button", { name: "Edit" }), "the focus goes back to Edit");
  assert.ok(await view.findByText("Retries too."));
});

test("an edit with no name is not sent, and the name field says why", async () => {
  const { view, saves } = mount();
  fireEvent.click(await view.findByRole("button", { name: "Edit" }));
  fireEvent.change(view.getByRole("textbox", { name: "Name" }), { target: { value: "" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));

  assert.deepEqual(saves, []);
  assert.equal(view.getByRole("alert").textContent, "Give it a name.");
});

test("an open edit outlives the page, as when bb redraws the panel, and Cancel drops it", async () => {
  const first = mount();
  fireEvent.click(await first.view.findByRole("button", { name: "Edit" }));
  fireEvent.change(first.view.getByRole("textbox", { name: "Description" }), { target: { value: "Half typed" } });
  cleanup();

  const again = mount();
  const description = await again.view.findByRole("textbox", { name: "Description" });
  assert.ok(description instanceof HTMLTextAreaElement);
  assert.equal(description.value, "Half typed");
  fireEvent.click(again.view.getByRole("button", { name: "Cancel" }));
  assert.ok(again.view.getByText("Moves webhooks off cron."));
  assert.equal(localStorage.length, 0);
});

test("Esc closes an edit nothing changed in, and keeps one that has changes", async () => {
  const { view } = mount();
  fireEvent.click(await view.findByRole("button", { name: "Edit" }));
  const name = view.getByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: "Webhooks v2" } });
  fireEvent.keyDown(name, { key: "Escape" });
  assert.ok(view.getByRole("form", { name: "Edit profile" }), "a changed edit stays open");

  fireEvent.change(name, { target: { value: "Webhooks" } });
  fireEvent.keyDown(name, { key: "Escape" });
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
});

test("a started regional manager's page has Open thread, which opens its thread, and no composer", async () => {
  const { view } = mount();

  fireEvent.click(await view.findByRole("button", { name: "Open thread" }));

  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]);
  assert.equal(view.queryByTestId("bb-new-thread-composer"), null);
});

test("the board's Memory lists each file with its first line and last change; opening one shows it with the way back and Edit, whose Save writes it and closes the editor", async () => {
  const { view, calls } = mount();
  const memory = await view.findByRole("region", { name: /^Memory/ });
  const row = await within(memory).findByRole("button", { name: /PLAN\.md/ });
  assert.match(row.textContent ?? "", /PLAN\.md1\. Inventory the endpoints/);
  assert.ok(row.querySelector("time"));

  fireEvent.click(row);
  assert.ok(await within(memory).findByRole("heading", { level: 3, name: "PLAN.md" }));
  assert.ok(within(memory).getByRole("button", { name: "All files" }));
  fireEvent.click(within(memory).getByRole("button", { name: "Edit" }));
  const text = await within(memory).findByRole("textbox", { name: "PLAN.md" });
  fireEvent.change(text, { target: { value: "# Plan\n\n1. Retire the cron box\n" } });
  await act(async () => fireEvent.click(within(memory).getByRole("button", { name: "Save" })));

  assert.deepEqual(calls, [{ method: "memoryWrite", input: "# Plan\n\n1. Retire the cron box\n" }]);
  assert.equal(within(memory).queryByRole("textbox"), null, "the editor closed");
  fireEvent.click(within(memory).getByRole("button", { name: "All files" }));
  assert.ok(await within(memory).findByRole("button", { name: /PLAN\.md/ }));
});

test("Cancel in a memory file's editor drops the edit and shows the file again", async () => {
  const { view, calls } = mount();
  const memory = await view.findByRole("region", { name: /^Memory/ });
  fireEvent.click(await within(memory).findByRole("button", { name: /PLAN\.md/ }));
  fireEvent.click(await within(memory).findByRole("button", { name: "Edit" }));
  fireEvent.change(await within(memory).findByRole("textbox", { name: "PLAN.md" }), { target: { value: "Half typed" } });

  fireEvent.click(within(memory).getByRole("button", { name: "Cancel" }));

  assert.deepEqual(calls, []);
  assert.equal(within(memory).queryByRole("textbox"), null);
  assert.equal(localStorage.getItem(`coordinator-memory-drafts:${COORDINATOR}`), null);
});

test("a regional manager not started yet shows its profile above bb's composer, asking for its goal on a fresh worktree and auto, with no board, memory or Open thread", async () => {
  const { view } = mount({ started: false });

  assert.equal((await view.findByRole("heading", { level: 1 })).textContent, "Scout");
  const composer = await view.findByTestId("bb-new-thread-composer");
  assert.equal(view.getByTestId("bb-new-thread-composer-input").getAttribute("placeholder"), "What should Scout get done?");
  assert.deepEqual([composer.dataset.defaultProjectId, composer.dataset.defaultPermissionMode, JSON.parse(composer.dataset.defaultEnvironment ?? "null")], [
    PROJECT.id,
    "auto",
    { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
  ]);
  assert.deepEqual([view.queryByRole("button", { name: "Open thread" }), view.queryByRole("region", { name: /^Memory/ }), view.queryByText("Verify done handoffs")], [null, null, null]);
});

test("sending the goal starts the regional manager with the composer's request, and opens its thread", async () => {
  const { view, calls } = mount({ started: false });
  fireEvent.change(await view.findByTestId("bb-new-thread-composer-input"), { target: { value: "Migrate the webhook service" } });

  await act(async () => fireEvent.click(view.getByTestId("bb-new-thread-composer-submit")));

  const [start] = calls;
  assert.equal(start?.method, "startCoordinator");
  const { coordinatorId, request } = contract.startCoordinator.input.parse(start?.input);
  assert.deepEqual([coordinatorId, request.projectId, request.input], [COORDINATOR, PROJECT.id, [{ type: "text", text: "Migrate the webhook service", mentions: [] }]]);
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_9" }]);
});

test("Delete, in the Edit form of a regional manager not started yet, asks first; Keep keeps it, and Delete removes it and goes back to the list", async () => {
  const { view, calls, backs } = mount({ started: false });
  fireEvent.click(await view.findByRole("button", { name: "Edit" }));
  fireEvent.click(view.getByRole("button", { name: "Delete" }));
  fireEvent.click(view.getByRole("button", { name: "Keep" }));
  assert.deepEqual(calls, []);

  fireEvent.click(view.getByRole("button", { name: "Delete" }));
  assert.ok(view.getByText("Delete it?"));
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Delete" })));

  assert.deepEqual(calls, [{ method: "deleteCoordinator", input: { coordinatorId: COORDINATOR } }]);
  assert.deepEqual(backs, ["back"]);
  assert.equal(localStorage.getItem(`coordinator-profile-edit:${COORDINATOR}`), null);
});

test("a started regional manager's Edit form has no Delete: bb archives or deletes its thread", async () => {
  const { view } = mount();
  fireEvent.click(await view.findByRole("button", { name: "Edit" }));

  assert.equal(view.queryByRole("button", { name: "Delete" }), null);
});

test("an edit before the start saves the name with the rest, and the page shows it", async () => {
  const { view, saves } = mount({ started: false });
  fireEvent.click(await view.findByRole("button", { name: "Edit" }));
  fireEvent.change(view.getByRole("textbox", { name: "Name" }), { target: { value: "Scout v2" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  await act(() => view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.deepEqual(saves.map(({ name }) => name), ["Scout v2"]);
  assert.equal((await view.findByRole("heading", { level: 1 })).textContent, "Scout v2");
  assert.equal(view.getByTestId("bb-new-thread-composer-input").getAttribute("placeholder"), "What should Scout v2 get done?");
});
