import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { coordinatorContract as contract, type CoordinatorStart } from "../../contract.ts";
import { PROJECT } from "../test-sidebar.ts";

// The New page as bb mounts it: the profile's fields, where the regional manager works and what it
// runs on, with bb's own pickers, and Create, which starts it through startCoordinator and opens its
// thread. It has no prompt: the goal is typed in the thread.

const { NewCoordinator } = await import("./new-coordinator.tsx");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const PERSONAL = { ...PROJECT, id: "prj_personal", name: "Personal", isPersonal: true };
const CRON = { ...PROJECT, id: "prj_2", name: "Cron" };

/** The New page over a plugin that records every start it is asked for, and the threads bb opens. */
function mount() {
  const starts: CoordinatorStart[] = [];
  const rpc = {
    newSeed: () => ({ hostId: "host_1", execution: { providerId: "claude-code", model: "opus", reasoningLevel: "high" } }),
    startCoordinator: (input: unknown) => {
      starts.push(contract.startCoordinator.input.parse(input));
      return { threadId: "thr_1" };
    },
  };
  const view = renderSlot({ component: NewCoordinator }, { ref: null, onBack: () => {} }, { rpc, sidebarThreads: { status: "ready", threads: [], projects: [PERSONAL, PROJECT, CRON] } });
  return {
    view,
    starts,
    async named(name: string) {
      fireEvent.change(await view.findByRole("textbox", { name: "Name" }), { target: { value: name } });
    },
    async create() {
      await act(async () => fireEvent.click(view.getByRole("button", { name: "Create" })));
    },
  };
}

test("the page has no prompt: its only text fields are the profile's", async () => {
  const page = mount();
  await page.view.findByRole("button", { name: "Create" });

  assert.deepEqual(
    page.view.getAllByRole("textbox").map((field) => field.getAttribute("aria-label")),
    // why the rest: the stand-ins the SDK's test app draws for bb's branch and model pickers.
    ["Name", "Description", "From:", "Provider ID", "Model", "Reasoning level"],
  );
  assert.equal(page.view.queryByTestId("bb-new-thread-composer-input"), null);
});

test("a create with no name is refused: the name field says so and takes the focus, and nothing starts", async () => {
  const page = mount();
  await page.named("   ");

  await page.create();

  const name = page.view.getByRole("textbox", { name: "Name" });
  assert.equal(page.view.getByRole("alert").textContent, "Give it a name.");
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.ok(document.activeElement === name, "the name field has the focus");
  assert.deepEqual(page.starts, []);
});

test("Create starts it in a fresh worktree of the first project, on bb's default execution and auto, sends the profile as typed, opens its thread and forgets the fields", async () => {
  const page = mount();
  await page.named("  Webhooks ");
  fireEvent.change(page.view.getByRole("textbox", { name: "Description" }), { target: { value: " " } });
  fireEvent.click(page.view.getByRole("radio", { name: "Lightning" }));

  await page.create();

  assert.deepEqual(page.starts, [
    {
      request: {
        projectId: "prj_1",
        providerId: "claude-code",
        model: "opus",
        reasoningLevel: "high",
        permissionMode: "auto",
        environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
      },
      verify: true,
      profile: { name: "Webhooks", description: null, avatar: { kind: "icon", icon: "Zap" } },
    },
  ]);
  assert.deepEqual(page.view.navigateCalls, [{ method: "toThread", threadId: "thr_1" }]);
  assert.equal(localStorage.getItem("coordinator-new-profile"), null);
});

test("what the user picks is what starts: the project, the base branch, the model, the permission mode and verification", async () => {
  const page = mount();
  await page.named("Cron");
  fireEvent.change(page.view.getByRole("combobox", { name: "Project" }), { target: { value: "prj_2" } });
  fireEvent.change(page.view.getByRole("textbox", { name: "From:" }), { target: { value: "release/2" } });
  fireEvent.change(page.view.getByRole("textbox", { name: "Model" }), { target: { value: "sonnet" } });
  fireEvent.change(page.view.getByRole("combobox", { name: "Service tier" }), { target: { value: "fast" } });
  fireEvent.click(page.view.getByRole("button", { name: "Apply execution selection" }));
  fireEvent.change(page.view.getByRole("combobox", { name: "Permission mode" }), { target: { value: "accept-edits" } });
  fireEvent.click(page.view.getByRole("switch", { name: "Verify done handoffs" }));

  await page.create();

  assert.deepEqual(page.starts.map(({ request, verify }) => ({ request, verify })), [
    {
      request: {
        projectId: "prj_2",
        providerId: "claude-code",
        model: "sonnet",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "accept-edits",
        environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "release/2" } } },
      },
      verify: false,
    },
  ]);
});

test("the project checkout and no project start where they say, and no project hides the project and branch", async () => {
  const page = mount();
  await page.named("Webhooks");
  fireEvent.click(page.view.getByRole("radio", { name: "Project checkout" }));
  assert.equal(page.view.queryByRole("textbox", { name: "From:" }), null, "a checkout is cut from no branch");
  await page.create();
  // why named again: a create forgets the profile's fields.
  await page.named("Webhooks");
  fireEvent.click(page.view.getByRole("radio", { name: "No project" }));
  assert.equal(page.view.queryByRole("combobox", { name: "Project" }), null);
  await page.create();

  assert.deepEqual(page.starts.map(({ request }) => [request.projectId, request.environment]), [
    ["prj_1", { type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: null } }],
    ["prj_personal", { type: "host", hostId: "host_1", workspace: { type: "personal" } }],
  ]);
});

test("the pickers read bb's catalog on the machine running bb", async () => {
  const page = mount();
  const picker = await page.view.findByTestId("bb-provider-model-picker");
  assert.deepEqual([picker.dataset.routingKind, picker.dataset.routingId], ["host", "host_1"]);
  const modes = page.view.getByTestId("bb-permission-mode-picker");
  assert.deepEqual([modes.dataset.routingKind, modes.dataset.routingId, modes.dataset.providerId], ["host", "host_1", "claude-code"]);
  assert.deepEqual([page.view.getByTestId("bb-branch-picker").dataset.hostId, page.view.getByTestId("bb-branch-picker").dataset.projectId], ["host_1", "prj_1"]);
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
