import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { coordinatorContract as contract, type CoordinatorStart } from "../../contract.ts";
import { PROJECT } from "../test-sidebar.ts";

// The New page as bb mounts it: the profile's fields above bb's composer, whose submit starts the
// regional manager through startCoordinator.

const { NewCoordinator } = await import("./new-coordinator.tsx");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The New page over a plugin that records every start it is asked for. */
function mount() {
  const starts: CoordinatorStart[] = [];
  const rpc = {
    primaryHost: () => ({ hostId: "host_1" }),
    startCoordinator: (input: unknown) => {
      starts.push(contract.startCoordinator.input.parse(input));
      return { threadId: "thr_1" };
    },
  };
  const view = renderSlot({ component: NewCoordinator }, { ref: null, onBack: () => {} }, { rpc, sidebarThreads: { status: "ready", threads: [], projects: [PROJECT] } });
  return {
    view,
    starts,
    async typeGoal(goal: string) {
      fireEvent.change(await view.findByTestId("bb-new-thread-composer-input"), { target: { value: goal } });
    },
    /** bb's composer submits, and the page's submit settles: "accepted", or the error it refused with. */
    async submit(): Promise<unknown> {
      // why take the runner's listeners off: the SDK's stand-in composer drops the promise its submit
      // returns, where bb's awaits it and keeps the draft, so a refusal reaches the process unhandled,
      // and the runner would fail the test on it.
      const runner = process.listeners("unhandledRejection");
      process.removeAllListeners("unhandledRejection");
      try {
        const refused = new Promise<unknown>((resolve) => process.once("unhandledRejection", resolve));
        await act(async () => fireEvent.click(view.getByTestId("bb-new-thread-composer-submit")));
        return await Promise.race([refused, new Promise((resolve) => setTimeout(() => resolve("accepted"), 20))]);
      } finally {
        process.removeAllListeners("unhandledRejection");
        for (const listener of runner) process.on("unhandledRejection", listener);
      }
    },
  };
}

test("a start with no name is refused: the name field says so and takes the focus, nothing starts, and the composer is told why", async () => {
  const page = mount();
  await page.typeGoal("Migrate the webhook service");
  fireEvent.change(page.view.getByRole("textbox", { name: "Name" }), { target: { value: "   " } });

  const refused = await page.submit();

  assert.ok(refused instanceof Error);
  assert.equal(refused.message, "Give it a name.");
  const name = page.view.getByRole("textbox", { name: "Name" });
  assert.equal(page.view.getByRole("alert").textContent, "Give it a name.");
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.ok(document.activeElement === name, "the name field has the focus");
  assert.deepEqual(page.starts, []);
});

test("a start with a name sends the profile as typed, the blank description as none, and the browser forgets the fields", async () => {
  const page = mount();
  await page.typeGoal("Migrate the webhook service");
  fireEvent.change(page.view.getByRole("textbox", { name: "Name" }), { target: { value: "  Webhooks " } });
  fireEvent.change(page.view.getByRole("textbox", { name: "Description" }), { target: { value: " " } });
  fireEvent.click(page.view.getByRole("radio", { name: "Lightning" }));

  assert.equal(await page.submit(), "accepted");

  assert.deepEqual(
    page.starts.map(({ verify, profile }) => ({ verify, profile })),
    [{ verify: true, profile: { name: "Webhooks", description: null, avatar: { kind: "icon", icon: "Zap" } } }],
  );
  assert.equal(localStorage.getItem("coordinator-new-profile"), null);
});

test("the fields outlive the page, as the composer's goal does", async () => {
  const page = mount();
  fireEvent.change(await page.view.findByRole("textbox", { name: "Name" }), { target: { value: "Webhooks" } });
  fireEvent.click(page.view.getByRole("radio", { name: "Brain" }));
  cleanup();

  const again = mount();
  const name = await again.view.findByRole("textbox", { name: "Name" });
  assert.ok(name instanceof HTMLInputElement);
  assert.equal(name.value, "Webhooks");
  assert.equal(again.view.getByRole("radio", { name: "Brain" }).matches(":checked"), true);
});
