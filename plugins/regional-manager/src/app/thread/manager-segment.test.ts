import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createElement, Fragment, useState } from "react";
import { COORDINATORS_TAG, coordinatorContract as contract, type Coordinator } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { PROJECT, sidebarThread } from "../test-sidebar.ts";

const { managerSegment } = await import("./manager-segment.tsx");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function ContextRow({ threadId }: { threadId: string }) {
  const [isExpanded, setExpanded] = useState(false);
  const props = { threadId, projectId: PROJECT.id, environment: null, segments: [], isExpanded, onToggle: () => setExpanded((expanded) => !expanded) };
  return createElement(Fragment, null, createElement(managerSegment.summary, props), createElement(managerSegment.details, props));
}

function mount(threadId: string, saved: Promise<void> = Promise.resolve()) {
  let coordinator: Coordinator = { id: coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10"), threadId: "thr_1", projectId: PROJECT.id, description: "Moves webhooks off cron.", avatar: { kind: "icon", icon: "Target" } };
  const saves: Profile[] = [];
  let answered!: () => void;
  const coordinatorsRead = new Promise<void>((resolve) => (answered = resolve));
  const rpc = {
    coordinators: () => {
      answered();
      return { coordinators: [coordinator], notStarted: [] };
    },
    setProfile: async (input: unknown) => {
      await saved;
      const { profile } = contract.setProfile.input.parse(input);
      saves.push(profile);
      coordinator = { ...coordinator, description: profile.description, avatar: profile.avatar };
      return {};
    },
  };
  const view = renderSlot({ component: ContextRow }, { threadId }, { experimental_rpcContract: contract, rpc, sidebarThreads: { status: "ready", threads: [sidebarThread("thr_1", "Webhooks")], projects: [PROJECT] } });
  return { view, saves, coordinatorsRead };
}

test("a regional manager's thread shows its icon and its name, and not its description", async () => {
  const { view } = mount("thr_1");

  assert.ok(await view.findByText("Webhooks"));
  assert.ok(view.container.querySelector('[data-icon="Target"]'), "its avatar");
  assert.equal(view.queryByText("Moves webhooks off cron."), null);
});

test("any other thread shows nothing", async () => {
  const { view, coordinatorsRead } = mount("thr_other");

  await act(() => coordinatorsRead);
  assert.equal(view.container.textContent, "");
});

test("pressing the icon and name opens the profile's editor on the name, and Save sends the changed profile, closes it and gives the focus back to them", async () => {
  const { view, saves } = mount("thr_1");
  const toggle = await view.findByRole("button", { name: "Webhooks, edit profile" });
  toggle.focus();
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const name = view.getByRole("textbox", { name: "Name" });
  assert.ok(document.activeElement === name, "the focus the toggle had moves to the name");

  fireEvent.change(name, { target: { value: "Webhooks v2" } });
  fireEvent.click(view.getByRole("radio", { name: "Brain" }));
  view.getByRole("button", { name: "Save" }).focus();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  await act(() => view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.deepEqual(saves, [{ name: "Webhooks v2", description: "Moves webhooks off cron.", avatar: { kind: "icon", icon: "Brain" } }]);
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(document.activeElement === toggle, "the focus goes back to the toggle");
  await waitFor(() => assert.ok(view.container.querySelector('[data-icon="Brain"]'), "the new icon"));
});

test("Esc closes an edit nothing changed in, with the focus back on the toggle; Cancel drops one that has changes", async () => {
  const { view, saves } = mount("thr_1");
  const toggle = await view.findByRole("button", { name: "Webhooks, edit profile" });
  toggle.focus();
  fireEvent.click(toggle);
  fireEvent.keyDown(view.getByRole("textbox", { name: "Name" }), { key: "Escape" });
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
  assert.ok(document.activeElement === toggle);

  fireEvent.click(toggle);
  const description = view.getByRole("textbox", { name: "Description" });
  fireEvent.change(description, { target: { value: "Half typed" } });
  fireEvent.keyDown(description, { key: "Escape" });
  assert.ok(view.getByRole("form", { name: "Edit profile" }), "a changed edit stays open");
  view.getByRole("button", { name: "Cancel" }).focus();
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  assert.deepEqual(saves, []);
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
  assert.ok(document.activeElement === toggle);
  assert.equal(localStorage.length, 0);
});

test("a save that lands after Cancel leaves the editor closed", async () => {
  let land!: () => void;
  const { view } = mount("thr_1", new Promise((resolve) => (land = resolve)));
  const toggle = await view.findByRole("button", { name: "Webhooks, edit profile" });
  fireEvent.click(toggle);
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), { target: { value: "Saved later" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  await act(async () => land());

  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("form", { name: "Edit profile" }), null);
});

test("a save that lands after the editor was closed and opened again leaves the new edit open, as typed", async () => {
  let land!: () => void;
  const { view } = mount("thr_1", new Promise((resolve) => (land = resolve)));
  const toggle = await view.findByRole("button", { name: "Webhooks, edit profile" });
  fireEvent.click(toggle);
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), { target: { value: "First" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), { target: { value: "Newer" } });

  await act(async () => land());

  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const description = view.getByRole("textbox", { name: "Description" });
  assert.ok(description instanceof HTMLTextAreaElement);
  assert.equal(description.value, "Newer");
});

test("an edit left open outlives the row, as when bb redraws it", async () => {
  const first = mount("thr_1");
  fireEvent.click(await first.view.findByRole("button", { name: "Webhooks, edit profile" }));
  fireEvent.change(first.view.getByRole("textbox", { name: "Description" }), { target: { value: "Half typed" } });
  cleanup();

  const again = mount("thr_1");
  fireEvent.click(await again.view.findByRole("button", { name: "Webhooks, edit profile" }));
  const description = again.view.getByRole("textbox", { name: "Description" });
  assert.ok(description instanceof HTMLTextAreaElement);
  assert.equal(description.value, "Half typed");
});
