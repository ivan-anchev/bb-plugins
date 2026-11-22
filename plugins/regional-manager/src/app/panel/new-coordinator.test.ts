import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { COORDINATORS_TAG, coordinatorContract as contract, type NotStarted } from "../../contract.ts";
import type { NewProfile } from "../../model/profile/profile.ts";
import { avatarSchema, HUE_NAMES, SHAPES } from "../../model/profile/avatar.ts";
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
  const creates: NewProfile[] = [];
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
    /** The names of the radios checked: the look's shape and colour. */
    chosen: () => view.getAllByRole("radio").filter((radio) => radio.matches(":checked")).map((radio) => radio.getAttribute("aria-label")),
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

test("a new manager's look the user didn't pick is a preview, which steps past the looks read, and Create asks the store to pick it", async (t) => {
  // why 0: the preview then starts from the look Scout has, which it must step past.
  t.mock.method(Math, "random", () => 0);
  const page = mount();
  await page.named("Webhooks");
  await waitFor(() => assert.notDeepEqual(page.chosen(), ["Circle", "Violet"]));

  await page.create();

  assert.deepEqual(page.creates, [{ name: "Webhooks", description: null, avatar: { kind: "auto" } }]);
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

test("while the other managers can't be read, a new one can still be created, its look picked by the store, and Shuffle waits and says why", async () => {
  const page = mount({ failing: true });

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /so Shuffle waits: .*bb is restarting/);
  assert.equal(page.view.getByRole("button", { name: "Shuffle" }).getAttribute("aria-disabled"), "true");
  await page.named("Webhooks");
  await page.create();

  assert.deepEqual(page.creates, [{ name: "Webhooks", description: null, avatar: { kind: "auto" } }]);
});

test("Shuffle waits while the other managers' looks can't be read, and says why; once Retry reads them, the focus Retry had moves to Shuffle, which picks a look none has", async (t) => {
  t.mock.method(Math, "random", () => 0);
  localStorage.setItem("coordinator-new-profile", JSON.stringify({ name: "Webhooks", description: "", avatar: CIRCLE_IN_VIOLET }));
  const read = { failing: true };
  const page = mount(read);
  const shuffle = await page.view.findByRole("button", { name: "Shuffle" });

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /Could not read the other regional managers' looks, so Shuffle waits: .*bb is restarting/);
  assert.equal(shuffle.getAttribute("aria-disabled"), "true");
  fireEvent.click(shuffle);
  assert.deepEqual(page.chosen(), ["Circle", "Violet"], "a Shuffle that can't know the taken looks picks none");

  read.failing = false;
  const retry = page.view.getByRole("button", { name: "Retry" });
  // why focus first: a click focuses the button in a browser, and jsdom's doesn't.
  retry.focus();
  await act(async () => fireEvent.click(retry));
  await waitFor(() => assert.equal(shuffle.getAttribute("aria-disabled"), "false"));
  assert.ok(document.activeElement === shuffle, "the focus Retry had is on Shuffle");
  fireEvent.click(shuffle);

  assert.notDeepEqual(page.chosen(), ["Circle", "Violet"], "Shuffle steps past Scout's look");
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

test("a later read that fails keeps a new manager's fields and its preview, and Shuffle waits", async () => {
  const read = { failing: false };
  const page = mount(read);
  await page.view.findByRole("textbox", { name: "Name" });
  const given = page.chosen();

  read.failing = true;
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));

  assert.match((await page.view.findByRole("alert")).textContent ?? "", /so Shuffle waits: .*bb is restarting/);
  assert.equal(page.view.getByRole("button", { name: "Shuffle" }).getAttribute("aria-disabled"), "true");
  assert.deepEqual(page.chosen(), given, "the preview stays the one from the last list read");
  await page.named("Webhooks");
  await page.create();
  assert.deepEqual(page.creates.map(({ avatar }) => avatar), [{ kind: "auto" }]);
});

test("a new manager's preview moves on when a later read shows another manager has taken it since", async () => {
  const read: { failing: boolean; others: NotStarted[] } = { failing: false, others: [] };
  const page = mount(read);
  await page.view.findByRole("textbox", { name: "Name" });
  const [shape, hue] = page.chosen().map((label) => label?.toLowerCase());
  const given = avatarSchema.parse({ kind: "blob", shape, hue, expression: "neutral" });

  read.others = [{ id: coordinatorIdSchema.parse("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"), name: "Docs", description: null, avatar: given }];
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));

  await waitFor(() => assert.notDeepEqual(page.chosen().map((label) => label?.toLowerCase()), [given.shape, given.hue]));
  await page.named("Webhooks");
  await page.create();
  assert.deepEqual(page.creates.map(({ avatar }) => avatar), [{ kind: "auto" }]);
});

test("fields an earlier release kept, with an icon this one can't draw, keep their name and description, and Create asks the store to pick the look", async () => {
  // why raw text with an icon: what 0.7.0 kept in the browser before avatars were blobs.
  localStorage.setItem("coordinator-new-profile", '{"name":"Half typed","description":"Moves webhooks","avatar":{"kind":"icon","icon":"Zap"}}');
  const page = mount();

  const name = await page.view.findByRole("textbox", { name: "Name" });
  assert.ok(name instanceof HTMLInputElement);
  assert.equal(name.value, "Half typed");
  await page.create();

  assert.deepEqual(page.creates, [{ name: "Half typed", description: "Moves webhooks", avatar: { kind: "auto" } }]);
});

test("a new manager's preview moves on when a later read shows it taken, even after the name was typed; a look the user picked stays and Create sends it", async (t) => {
  // why 0: the page then gives pebble in violet, the first look after Scout's, so the look picked below (a bunny) is never the one given.
  t.mock.method(Math, "random", () => 0);
  const read: { failing: boolean; others: NotStarted[] } = { failing: false, others: [] };
  const page = mount(read);
  await page.named("Webhooks");
  const [shape, hue] = page.chosen().map((label) => label?.toLowerCase());
  const given = avatarSchema.parse({ kind: "blob", shape, hue, expression: "neutral" });

  read.others = [{ id: coordinatorIdSchema.parse("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"), name: "Docs", description: null, avatar: given }];
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));
  await waitFor(() => assert.notDeepEqual(page.chosen().map((label) => label?.toLowerCase()), [given.shape, given.hue]));

  fireEvent.click(page.view.getByRole("radio", { name: "Bunny" }));
  const picked = page.chosen().map((label) => label?.toLowerCase());
  read.others = [...read.others, { id: coordinatorIdSchema.parse("2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a"), name: "Ops", description: null, avatar: avatarSchema.parse({ kind: "blob", shape: picked[0], hue: picked[1], expression: "neutral" }) }];
  await act(() => page.view.experimental_invalidateRpc([COORDINATORS_TAG]));
  assert.deepEqual(page.chosen().map((label) => label?.toLowerCase()), picked, "a look the user picked stays, though another manager has it");

  await page.create();
  assert.deepEqual(page.creates.map(({ name, avatar }) => [name, avatar.kind === "blob" ? [avatar.shape, avatar.hue] : avatar.kind]), [["Webhooks", picked]]);
});

test("Shuffle never lands on a look another manager has while one is free: with 251 taken and its own the one free, it keeps it", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const looks = HUE_NAMES.flatMap((hue) => SHAPES.map((shape) => avatarSchema.parse({ kind: "blob", shape, hue, expression: "neutral" })));
  const [free] = looks.slice(-1);
  assert.ok(free);
  // why 250 more: with Scout's circle in violet, every look but the last is taken.
  const others = looks.slice(1, -1).map((avatar, n) => ({ id: coordinatorIdSchema.parse(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), name: `Manager ${n}`, description: null, avatar }));
  localStorage.setItem("coordinator-new-profile", JSON.stringify({ name: "Webhooks", description: "", avatar: free }));
  const page = mount({ failing: false, others });
  const shuffle = await page.view.findByRole("button", { name: "Shuffle" });
  await waitFor(() => assert.equal(shuffle.getAttribute("aria-disabled"), "false"));

  fireEvent.click(shuffle);

  assert.deepEqual(page.chosen().map((label) => label?.toLowerCase()), [free.shape, free.hue]);
});
