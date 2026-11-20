import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";

// The New page as bb mounts it: the profile's fields under its heading, and Create, which saves the
// regional manager through createCoordinator, with no thread, and opens its page.

const { NewCoordinator } = await import("./new-coordinator.tsx");

const CREATED = "6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The New page over a plugin that records every profile it is asked to create, and the pages it opens. */
function mount() {
  const creates: Profile[] = [];
  const opened: CoordinatorId[] = [];
  const rpc = {
    createCoordinator: (input: unknown) => {
      creates.push(contract.createCoordinator.input.parse(input).profile);
      return { coordinatorId: CREATED };
    },
  };
  const view = renderSlot({ component: NewCoordinator }, { ref: null, onBack: () => {}, onCreated: (id: CoordinatorId) => void opened.push(id) }, { rpc });
  return {
    view,
    creates,
    opened,
    async named(name: string) {
      fireEvent.change(await view.findByRole("textbox", { name: "Name" }), { target: { value: name } });
    },
    async create() {
      await act(async () => fireEvent.click(view.getByRole("button", { name: "Create" })));
    },
  };
}

test("the page is the profile's fields under its heading, and Create: no prompt, no place, no pickers", async () => {
  const page = mount();
  await page.view.findByRole("button", { name: "Create" });

  assert.equal(page.view.getByRole("heading", { level: 1 }).textContent, "New regional manager");
  assert.deepEqual(
    page.view.getAllByRole("textbox").map((field) => field.getAttribute("aria-label")),
    ["Name", "Description"],
  );
  assert.deepEqual([page.view.queryByTestId("bb-new-thread-composer"), page.view.queryByRole("combobox"), page.view.queryByRole("switch")], [null, null, null]);
});

test("a create with no name is refused: the name field says so and takes the focus, and nothing is created", async () => {
  const page = mount();
  await page.named("   ");

  await page.create();

  const name = page.view.getByRole("textbox", { name: "Name" });
  assert.equal(page.view.getByRole("alert").textContent, "Give it a name.");
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.ok(document.activeElement === name, "the name field has the focus");
  assert.deepEqual(page.creates, []);
});

test("Create sends the profile as typed, opens the new regional manager's page, starts no thread and forgets the fields", async () => {
  const page = mount();
  await page.named("  Webhooks ");
  fireEvent.change(page.view.getByRole("textbox", { name: "Description" }), { target: { value: " " } });
  fireEvent.click(page.view.getByRole("radio", { name: "Lightning" }));

  await page.create();

  assert.deepEqual(page.creates, [{ name: "Webhooks", description: null, avatar: { kind: "icon", icon: "Zap" } }]);
  assert.deepEqual(page.opened, [CREATED]);
  assert.deepEqual(page.view.navigateCalls, []);
  assert.equal(localStorage.getItem("coordinator-new-profile"), null);
});

test("the form's submit, which Enter in a field sends, creates it", async () => {
  const page = mount();
  await page.named("Webhooks");

  await act(async () => fireEvent.submit(page.view.getByRole("textbox", { name: "Name" })));

  assert.deepEqual(page.creates.map(({ name }) => name), ["Webhooks"]);
});

test("the fields outlive the page", async () => {
  const page = mount();
  await page.named("Webhooks");
  fireEvent.click(page.view.getByRole("radio", { name: "Brain" }));
  cleanup();

  const again = mount();
  const name = await again.view.findByRole("textbox", { name: "Name" });
  assert.ok(name instanceof HTMLInputElement);
  assert.equal(name.value, "Webhooks");
  assert.equal(again.view.getByRole("radio", { name: "Brain" }).matches(":checked"), true);
});
