import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { boardTag, coordinatorContract } from "../../../contract.ts";
import { coordinatorIdSchema } from "../../../model/role.ts";
import { PROJECT, sidebarThread } from "../../test-sidebar.ts";

// The Board's verification chip as bb mounts the Board: the state it reads from the board, the menu
// the chip opens, and the switch in it saving through setVerify, which the server answers by marking
// the board's read stale, as the plugin's server does.

// why: jsdom has none; the rows measure their titles, and the menu's placement watches its size.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const { Board } = await import("../board.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const MANAGER = { id: COORDINATOR, threadId: "thr_manager", projectId: PROJECT.id, description: null, avatar: { kind: "blob", shape: "circle", hue: "purple", expression: "neutral" } } as const;
const ON_MEANS = "A reviewer, then a verifier, check each new done handoff before the regional manager hears of it.";
const OFF_MEANS = "New done handoffs skip review and verification.";

afterEach(cleanup);

type Server = {
  /** What a save does: stores the value and marks the board stale (the default), or what the test makes it. */
  save?(verify: boolean, store: () => Promise<void>): Promise<void>;
};

/** The Board reading `verify`, each setVerify call's input in `saves`, and the chip once drawn. */
async function mount(verify: boolean, server: Server = {}) {
  let stored = verify;
  const saves: { coordinatorId: string; verify: boolean }[] = [];
  const store = async (next: boolean) => {
    stored = next;
    await view.experimental_invalidateRpc([boardTag(COORDINATOR)]);
  };
  const view = renderSlot({ component: Board }, { coordinatorId: COORDINATOR }, {
    experimental_rpcContract: coordinatorContract,
    rpc: {
      board: () => ({ verify: stored, ownEdits: null, prUnavailable: null, decisions: [], issues: [] }),
      setVerify: async (input: unknown) => {
        const asked = coordinatorContract.setVerify.input.parse(input);
        saves.push(asked);
        await (server.save ?? ((_next, save) => save()))(asked.verify, () => store(asked.verify));
        return {};
      },
      coordinators: () => ({ coordinators: [MANAGER], notStarted: [] }),
    },
    sidebarThreads: { status: "ready", threads: [sidebarThread(MANAGER.threadId, "Webhook retries")], projects: [PROJECT] },
  });
  await view.findByRole("button", { name: /^Verification (on|off)\./ });
  const chip = () => {
    const chips = view.getAllByRole("button", { name: /^Verification (on|off)\./ });
    assert.equal(chips.length, 1, "one chip");
    return chips[0] ?? assert.fail();
  };
  const menu = () => within(view.getByRole("dialog", { name: "Verification" }));
  const toggle = () => menu().getByRole("switch", { name: "Verify done handoffs" });
  return { view, chip, menu, toggle, saves };
}

/** The text an element's aria-describedby points at. */
const description = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

const warningGlyph = (chip: HTMLElement) => chip.querySelector(".text-warning-text");

test("on: one quiet chip reading Verification on, with no warning glyph and no hint on the Board, named for the state", async () => {
  const { view, chip } = await mount(true);
  assert.equal(chip().textContent, "Verification on");
  assert.equal(warningGlyph(chip()), null, "no warning glyph");
  assert.equal(chip().getAttribute("aria-label"), `Verification on. ${ON_MEANS}`);
  assert.equal(chip().getAttribute("aria-expanded"), "false", "its menu starts closed");
  for (const hint of [ON_MEANS, OFF_MEANS, /hidden reviewer/, /reach the regional manager unverified/]) {
    assert.equal(view.queryByText(hint), null, `no hint paragraph: ${hint}`);
  }
});

test("off: the chip reads Verification off with the warning glyph in --warning-text, and its name says what off means", async () => {
  const { chip } = await mount(false);
  assert.equal(chip().textContent, "Verification off");
  assert.ok(warningGlyph(chip()), "the warning glyph, in the warning text token");
  assert.equal(chip().getAttribute("aria-label"), `Verification off. ${OFF_MEANS}`);
});

test("pressing the chip opens its menu: the switch and what the state means; the switch saves the toggled value once and the menu stays, and Escape closes it back to the chip", async () => {
  const { chip, menu, toggle, saves } = await mount(true);
  fireEvent.click(chip());
  assert.equal(chip().getAttribute("aria-expanded"), "true");
  assert.equal(toggle().getAttribute("aria-checked"), "true");
  assert.equal(description(toggle()), ON_MEANS, "the on line, as the switch's description");
  assert.ok(menu().getByText(ON_MEANS));

  fireEvent.click(toggle());
  await waitFor(() => assert.equal(chip().textContent, "Verification off"));
  assert.deepEqual(saves, [{ coordinatorId: COORDINATOR, verify: false }]);
  assert.equal(toggle().getAttribute("aria-checked"), "false");
  assert.equal(description(toggle()), OFF_MEANS, "the line follows the state, in the menu still open");

  toggle().focus();
  fireEvent.keyDown(toggle(), { key: "Escape" });
  await waitFor(() => assert.equal(chip().getAttribute("aria-expanded"), "false"));
  assert.equal(document.activeElement, chip(), "focus is back on the chip");
});

test("a failed save puts the chip and the switch back to the stored value and says why in the menu, as an alert; pressing again retries, and it saves", async () => {
  let fails = true;
  const { chip, menu, toggle, saves } = await mount(true, {
    save: (_next, store) => (fails ? Promise.reject(new Error("bb is restarting")) : store()),
  });
  fireEvent.click(chip());
  fireEvent.click(toggle());
  const alert = await menu().findByRole("alert");
  assert.match(alert.textContent ?? "", /^Couldn't turn verification off: .*bb is restarting/);
  assert.equal(chip().textContent, "Verification on", "the chip reverts");
  assert.equal(toggle().getAttribute("aria-checked"), "true", "and so does the switch");

  fails = false;
  fireEvent.click(toggle());
  await waitFor(() => assert.equal(chip().textContent, "Verification off"));
  assert.equal(menu().queryByRole("alert"), null, "the failure goes once a save lands");
  assert.deepEqual(
    saves.map((save) => save.verify),
    [false, false],
  );
});

test("while a save is pending, the chip and the switch show the asked value, dimmed with aria-disabled, and the switch ignores presses", async () => {
  let land = () => {};
  const { chip, toggle, saves } = await mount(true, {
    save: (_next, store) => new Promise<void>((resolve) => (land = () => void store().then(resolve))),
  });
  fireEvent.click(chip());
  fireEvent.click(toggle());
  await waitFor(() => assert.equal(toggle().getAttribute("aria-disabled"), "true"));
  assert.equal(toggle().getAttribute("aria-checked"), "false", "the asked value");
  assert.equal(chip().textContent, "Verification off");
  assert.equal(chip().getAttribute("aria-disabled"), "true");

  fireEvent.click(toggle());
  assert.equal(saves.length, 1, "a press while it saves does nothing");

  await act(async () => land());
  await waitFor(() => assert.equal(toggle().getAttribute("aria-disabled"), "false"));
  assert.equal(toggle().getAttribute("aria-checked"), "false");
  assert.equal(saves.length, 1);
});
