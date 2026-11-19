import "../test-browser.ts";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { COORDINATORS_TAG, coordinatorContract as contract, type Coordinator } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { PROJECT, sidebarThread } from "../test-sidebar.ts";

// The Board page in the panel as bb mounts it: the regional manager's profile above its board, its
// name from bb's thread list, the rest from the plugin; Edit opens it in place and saves it whole.

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

/** The page over a plugin holding one regional manager, which keeps every profile it is sent, as setProfile does but for the title, which bb keeps. */
function mount() {
  let stored: Coordinator = { id: COORDINATOR, threadId: "thr_1", projectId: PROJECT.id, verify: true, description: "Moves webhooks off cron.", avatar: { kind: "icon", icon: "Workflow" }, createdAt: 1_000 };
  const saves: Profile[] = [];
  const rpc = {
    coordinators: () => ({ coordinators: [stored] }),
    board: () => ({ awaitingGoal: false, verify: true, ownEdits: null, prUnavailable: null, digest: null, decisions: [], issues: [] }),
    setProfile: (input: unknown) => {
      const { profile } = contract.setProfile.input.parse(input);
      saves.push(profile);
      stored = { ...stored, description: profile.description, avatar: profile.avatar };
      return {};
    },
  };
  const view = renderSlot(
    { component: BoardPage },
    { ref: null, coordinatorId: COORDINATOR, onBack: () => {}, onOpenMemory: () => {} },
    { experimental_rpcContract: contract, rpc, sidebarThreads: { status: "ready", threads: [sidebarThread("thr_1", "Webhooks")], projects: [PROJECT] } },
  );
  return { view, saves };
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
