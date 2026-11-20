import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { COORDINATORS_TAG, coordinatorContract as contract, type Coordinator, type NotStarted } from "../../../contract.ts";
import type { Profile } from "../../../model/profile.ts";
import { coordinatorIdSchema } from "../../../model/role.ts";
import { PROJECT, sidebarThread } from "../../test-sidebar.ts";

// The page in the panel of a regional manager not started yet, as bb mounts it: its profile above
// bb's composer, whose message starts it. Edit opens the profile in place and saves it whole. A
// started one's page opens its thread.

const { ManagerPage } = await import("./manager-page.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * The page over a plugin holding one regional manager, not started unless told, which keeps every
 * profile it is sent, as setProfile does. A start binds its thread at once and replies once `replied`
 * settles, as the server's does.
 */
function mount({ started = false, replied = Promise.resolve() }: { started?: boolean; replied?: Promise<void> } = {}) {
  const profileOf = { description: "Moves webhooks off cron.", avatar: { kind: "icon", icon: "Workflow" } } as const;
  const stored: Coordinator = { id: COORDINATOR, threadId: "thr_1", projectId: PROJECT.id, ...profileOf };
  let waiting: NotStarted | null = started ? null : { id: COORDINATOR, name: "Scout", ...profileOf };
  const saves: Profile[] = [];
  const calls: { method: string; input: unknown }[] = [];
  const rpc = {
    coordinators: () => ({ coordinators: started ? [stored] : [], notStarted: waiting === null ? [] : [waiting] }),
    primaryHost: () => ({ hostId: "host_1" }),
    setProfile: (input: unknown) => {
      const { profile } = contract.setProfile.input.parse(input);
      saves.push(profile);
      if (waiting !== null) waiting = { ...waiting, ...profile };
      return {};
    },
    startCoordinator: async (input: unknown) => {
      calls.push({ method: "startCoordinator", input: contract.startCoordinator.input.parse(input) });
      started = true;
      waiting = null;
      await replied;
      return { threadId: stored.threadId };
    },
    deleteCoordinator: (input: unknown) => {
      calls.push({ method: "deleteCoordinator", input: contract.deleteCoordinator.input.parse(input) });
      waiting = null;
      return {};
    },
  };
  const backs: string[] = [];
  const view = renderSlot(
    { component: ManagerPage },
    { ref: null, coordinatorId: COORDINATOR, onBack: () => void backs.push("back") },
    { experimental_rpcContract: contract, rpc, sidebarThreads: { status: "ready", threads: [sidebarThread("thr_1", "Webhooks")], projects: [PROJECT] } },
  );
  return { view, saves, calls, backs };
}

test("the page's heading is the regional manager's name, with its description", async () => {
  const { view } = mount();

  assert.equal((await view.findByRole("heading", { level: 1 })).textContent, "Scout");
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

  fireEvent.change(name, { target: { value: "Scout v2" } });
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), { target: { value: "Retries too." } });
  fireEvent.click(view.getByRole("radio", { name: "Brain" }));
  view.getByRole("button", { name: "Save" }).focus();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  await act(() => view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.deepEqual(saves, [{ name: "Scout v2", description: "Retries too.", avatar: { kind: "icon", icon: "Brain" } }]);
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
  fireEvent.change(name, { target: { value: "Scout v2" } });
  fireEvent.keyDown(name, { key: "Escape" });
  assert.ok(view.getByRole("form", { name: "Edit profile" }), "a changed edit stays open");

  fireEvent.change(name, { target: { value: "Scout" } });
  fireEvent.keyDown(name, { key: "Escape" });
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
});

test("the page shows the profile above bb's composer, asking for its goal on a fresh worktree and auto", async () => {
  const { view } = mount();

  assert.equal((await view.findByRole("heading", { level: 1 })).textContent, "Scout");
  const composer = await view.findByTestId("bb-new-thread-composer");
  assert.equal(view.getByTestId("bb-new-thread-composer-input").getAttribute("placeholder"), "What should Scout get done?");
  assert.deepEqual([composer.dataset.defaultProjectId, composer.dataset.defaultPermissionMode, JSON.parse(composer.dataset.defaultEnvironment ?? "null")], [
    PROJECT.id,
    "auto",
    { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
  ]);
});

test("sending the goal starts the regional manager with the composer's request, and opens its thread", async () => {
  const { view, calls } = mount();
  fireEvent.change(await view.findByTestId("bb-new-thread-composer-input"), { target: { value: "Migrate the webhook service" } });

  await act(async () => fireEvent.click(view.getByTestId("bb-new-thread-composer-submit")));

  const [start] = calls;
  assert.equal(start?.method, "startCoordinator");
  const { coordinatorId, request } = contract.startCoordinator.input.parse(start?.input);
  assert.deepEqual([coordinatorId, request.projectId, request.input], [COORDINATOR, PROJECT.id, [{ type: "text", text: "Migrate the webhook service", mentions: [] }]]);
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]);
});

test("a start the page reads before its reply opens the thread once", async () => {
  let reply!: () => void;
  const { view } = mount({ replied: new Promise((resolve) => (reply = resolve)) });
  fireEvent.change(await view.findByTestId("bb-new-thread-composer-input"), { target: { value: "Migrate the webhook service" } });
  await act(async () => fireEvent.click(view.getByTestId("bb-new-thread-composer-submit")));
  await act(() => view.experimental_invalidateRpc([COORDINATORS_TAG]));
  await waitFor(() => assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]));

  await act(async () => reply());

  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]);
});

test("Delete, in the Edit form of a regional manager not started yet, asks first; Keep keeps it, and Delete removes it and goes back to the list", async () => {
  const { view, calls, backs } = mount();
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

test("an edit before the start saves the name with the rest, and the page shows it", async () => {
  const { view, saves } = mount();
  fireEvent.click(await view.findByRole("button", { name: "Edit" }));
  fireEvent.change(view.getByRole("textbox", { name: "Name" }), { target: { value: "Scout v2" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  await act(() => view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.deepEqual(saves.map(({ name }) => name), ["Scout v2"]);
  assert.equal((await view.findByRole("heading", { level: 1 })).textContent, "Scout v2");
  assert.equal(view.getByTestId("bb-new-thread-composer-input").getAttribute("placeholder"), "What should Scout v2 get done?");
});

test("a started regional manager's page, as from an old link, opens its thread and shows nothing", async () => {
  const { view } = mount({ started: true });

  await waitFor(() => assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]));
  assert.equal(view.queryByRole("heading"), null);
  assert.equal(view.queryByTestId("bb-new-thread-composer"), null);
});
