import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { COORDINATORS_TAG, coordinatorContract as contract, type NotStarted } from "../../contract.ts";
import type { Profile } from "../../model/profile/profile.ts";
import { avatarSchema } from "../../model/profile/avatar.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

// The New page as bb mounts it: the profile's fields under its heading, and Create, which saves the
// regional manager through createCoordinator, with no thread, and opens its page.

const { NewCoordinator } = await import("./new-coordinator.tsx");

const CREATED = "6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10";
const TAKEN = "0b9c8e5d-7a3f-4e2b-9c1d-5f6a7b8c9d0e";
const CIRCLE_IN_VIOLET = { kind: "blob", shape: "circle", hue: "violet", expression: "neutral" } as const;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * The New page over a plugin that records every profile it is asked to create, and the pages it
 * opens, and lists one other manager, Scout, unless `read.failing`, when its list read fails.
 */
function mount(read: { failing: boolean; others?: NotStarted[] } = { failing: false }) {
  const creates: Profile[] = [];
  const opened: CoordinatorId[] = [];
  const rpc = {
    coordinators: () => {
      if (read.failing) throw new Error("bb is restarting");
      return { coordinators: [], notStarted: [{ id: TAKEN, name: "Scout", description: null, avatar: CIRCLE_IN_VIOLET }, ...(read.others ?? [])] };
    },
    createCoordinator: (input: unknown) => {
      creates.push(contract.createCoordinator.input.parse(input).profile);
      return { coordinatorId: CREATED };
    },
  };
  const view = renderSlot({ component: NewCoordinator }, { ref: null, onBack: () => {}, onCreated: (id: CoordinatorId) => void opened.push(id) }, { experimental_rpcContract: contract, rpc });
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
  await page.view.findByRole("textbox", { name: "Name" });

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

test("a new regional manager's look is one no other manager has", async (t) => {
  // why 0: the look a new manager starts from is then the one Scout has, which it must step past.
  t.mock.method(Math, "random", () => 0);
  const page = mount();
  await page.named("Webhooks");
  await waitFor(() => assert.equal(page.view.getByRole("radio", { name: "Circle" }).matches(":checked"), false));

  await page.create();

  const [created] = page.creates;
  assert.ok(created);
  assert.notDeepEqual([created.avatar.shape, created.avatar.hue], [CIRCLE_IN_VIOLET.shape, CIRCLE_IN_VIOLET.hue]);
});

test("Create sends the profile as typed, opens the new regional manager's page, starts no thread and forgets the fields", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const page = mount();
  await page.named("  Webhooks ");
  fireEvent.change(page.view.getByRole("textbox", { name: "Description" }), { target: { value: " " } });
  fireEvent.click(page.view.getByRole("radio", { name: "Cloud" }));
  fireEvent.click(page.view.getByRole("radio", { name: "Amber" }));

  await page.create();

  assert.deepEqual(page.creates, [{ name: "Webhooks", description: null, avatar: { kind: "blob", shape: "cloud", hue: "amber", expression: "neutral" } }]);
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
  fireEvent.click(page.view.getByRole("radio", { name: "Cat" }));
  cleanup();

  const again = mount();
  const name = await again.view.findByRole("textbox", { name: "Name" });
  assert.ok(name instanceof HTMLInputElement);
  assert.equal(name.value, "Webhooks");
  assert.equal(again.view.getByRole("radio", { name: "Cat" }).matches(":checked"), true);
});

test("while the other managers can't be read, a new one gets no look: the page says why, and Retry gives it a free one", async (t) => {
  // why 0: the look a new manager starts from is then the one Scout has, which it must step past.
  t.mock.method(Math, "random", () => 0);
  const read = { failing: true };
  const page = mount(read);

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /Could not read the other regional managers, so a new one can't be given a look of its own yet: .*bb is restarting/);
  assert.equal(page.view.queryByRole("textbox", { name: "Name" }), null);
  const create = page.view.getByRole("button", { name: "Create" });
  assert.equal(create.getAttribute("aria-disabled"), "true");
  await page.create();
  assert.equal(page.creates.length, 0, "Create has nothing to create");

  read.failing = false;
  await act(async () => fireEvent.click(page.view.getByRole("button", { name: "Retry" })));

  await page.named("Webhooks");
  assert.equal(create.getAttribute("aria-disabled"), "false");
  assert.equal(page.view.queryByRole("alert"), null);
  await page.create();
  const [created] = page.creates;
  assert.ok(created);
  assert.notDeepEqual([created.avatar.shape, created.avatar.hue], [CIRCLE_IN_VIOLET.shape, CIRCLE_IN_VIOLET.hue]);
});

test("Shuffle waits while the other managers' looks can't be read, and says why; once Retry reads them, the focus Retry had moves to Shuffle, which picks a look none has", async (t) => {
  t.mock.method(Math, "random", () => 0);
  localStorage.setItem("coordinator-new-profile", JSON.stringify({ name: "Webhooks", description: "", avatar: CIRCLE_IN_VIOLET }));
  const read = { failing: true };
  const page = mount(read);
  const shuffle = await page.view.findByRole("button", { name: "Shuffle" });
  const chosen = () => page.view.getAllByRole("radio").filter((radio) => radio.matches(":checked")).map((radio) => radio.getAttribute("aria-label"));

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /Could not read the other regional managers' looks, so Shuffle waits: .*bb is restarting/);
  assert.equal(shuffle.getAttribute("aria-disabled"), "true");
  fireEvent.click(shuffle);
  assert.deepEqual(chosen(), ["Circle", "Violet"], "a Shuffle that can't know the taken looks picks none");

  read.failing = false;
  const retry = page.view.getByRole("button", { name: "Retry" });
  // why focus first: a click focuses the button in a browser, and jsdom's doesn't.
  retry.focus();
  await act(async () => fireEvent.click(retry));
  await waitFor(() => assert.equal(shuffle.getAttribute("aria-disabled"), "false"));
  assert.ok(document.activeElement === shuffle, "the focus Retry had is on Shuffle");
  fireEvent.click(shuffle);

  assert.notDeepEqual(chosen(), ["Circle", "Violet"], "Shuffle steps past Scout's look");
  assert.equal(page.view.queryByRole("alert"), null);
});

test("a later read of the managers that fails keeps their last list, but Shuffle waits and says why, since that list may lack a look taken since", async () => {
  localStorage.setItem("coordinator-new-profile", JSON.stringify({ name: "Webhooks", description: "", avatar: CIRCLE_IN_VIOLET }));
  const read = { failing: false };
  const page = mount(read);
  const shuffle = await page.view.findByRole("button", { name: "Shuffle" });
  await waitFor(() => assert.equal(shuffle.getAttribute("aria-disabled"), "false"));

  read.failing = true;
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /so Shuffle waits: .*bb is restarting/);
  assert.equal(shuffle.getAttribute("aria-disabled"), "true");
  fireEvent.click(shuffle);
  assert.equal(page.view.getByRole("radio", { name: "Circle" }).matches(":checked"), true, "Shuffle picked nothing");
  const name = page.view.getByRole("textbox", { name: "Name" });
  assert.ok(name instanceof HTMLInputElement);
  assert.equal(name.value, "Webhooks", "the fields stay");
});

test("a later read that fails keeps a new manager's fields and the look it was given while the looks were known, and Shuffle waits", async () => {
  const read = { failing: false };
  const page = mount(read);
  await page.view.findByRole("textbox", { name: "Name" });
  const chosen = () => page.view.getAllByRole("radio").filter((radio) => radio.matches(":checked")).map((radio) => radio.getAttribute("aria-label"));
  const given = chosen();

  read.failing = true;
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /so Shuffle waits: .*bb is restarting/);
  assert.equal(page.view.getByRole("button", { name: "Shuffle" }).getAttribute("aria-disabled"), "true");
  assert.deepEqual(chosen(), given, "the look stays the one given while the looks were known");
  await page.named("Webhooks");
  await page.create();
  const [created] = page.creates;
  assert.ok(created);
  assert.deepEqual([created.avatar.shape, created.avatar.hue], given.map((label) => label?.toLowerCase()));
  assert.notDeepEqual([created.avatar.shape, created.avatar.hue], [CIRCLE_IN_VIOLET.shape, CIRCLE_IN_VIOLET.hue]);
});

test("a new manager's look moves on when a later read shows another manager has taken it since", async () => {
  const read: { failing: boolean; others: NotStarted[] } = { failing: false, others: [] };
  const page = mount(read);
  await page.view.findByRole("textbox", { name: "Name" });
  const chosen = () => page.view.getAllByRole("radio").filter((radio) => radio.matches(":checked")).map((radio) => radio.getAttribute("aria-label"));
  const [shape, hue] = chosen().map((label) => label?.toLowerCase());
  const given = avatarSchema.parse({ kind: "blob", shape, hue, expression: "neutral" });

  read.others = [{ id: coordinatorIdSchema.parse("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"), name: "Docs", description: null, avatar: given }];
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));

  await waitFor(() => assert.notDeepEqual(chosen(), [given.shape, given.hue].map((label) => label.charAt(0).toUpperCase() + label.slice(1))));
  await page.named("Webhooks");
  await page.create();
  const [created] = page.creates;
  assert.ok(created);
  assert.notDeepEqual([created.avatar.shape, created.avatar.hue], [given.shape, given.hue]);
  assert.notDeepEqual([created.avatar.shape, created.avatar.hue], [CIRCLE_IN_VIOLET.shape, CIRCLE_IN_VIOLET.hue]);
});

test("fields an earlier release kept, with an icon this one can't draw, keep their name and description and get a look no other manager has", async (t) => {
  t.mock.method(Math, "random", () => 0);
  // why an icon: what 0.7.0 kept in the browser before avatars were blobs.
  localStorage.setItem("coordinator-new-profile", JSON.stringify({ name: "Half typed", description: "Moves webhooks", avatar: { kind: "icon", icon: "Zap" } }));
  const page = mount();

  const name = await page.view.findByRole("textbox", { name: "Name" });
  assert.ok(name instanceof HTMLInputElement);
  assert.equal(name.value, "Half typed");
  await page.create();

  const [created] = page.creates;
  assert.ok(created);
  assert.deepEqual([created.name, created.description, created.avatar.kind], ["Half typed", "Moves webhooks", "blob"]);
  assert.notDeepEqual([created.avatar.shape, created.avatar.hue], [CIRCLE_IN_VIOLET.shape, CIRCLE_IN_VIOLET.hue]);
});
