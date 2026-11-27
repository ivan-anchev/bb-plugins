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

/** The Board reading `verify`, each setVerify call's input in `saves`, what the server holds in `stored`, and the chip once drawn. */
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
  return { view, chip, menu, toggle, saves, stored: () => stored };
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
  const { chip, menu, toggle, saves, stored } = await mount(true, {
    save: (_next, store) => (fails ? Promise.reject(new Error("bb is restarting")) : store()),
  });
  fireEvent.click(chip());
  fireEvent.click(toggle());
  const alert = await menu().findByRole("alert");
  assert.match(alert.textContent ?? "", /^Couldn't turn verification off: .*bb is restarting/);
  assert.equal(chip().textContent, "Verification on", "the chip reverts");
  assert.equal(toggle().getAttribute("aria-checked"), "true", "and so does the switch");
  assert.equal(stored(), true);

  fails = false;
  fireEvent.click(toggle());
  // why wait for the switch: it takes input again only once the save has settled.
  await waitFor(() => assert.equal(toggle().getAttribute("aria-disabled"), "false"));
  assert.equal(stored(), false, "the retry saved");
  assert.equal(chip().textContent, "Verification off");
  assert.equal(menu().queryByRole("alert"), null, "the failure goes once a save lands");
  assert.deepEqual(
    saves.map((save) => save.verify),
    [false, false],
  );

  cleanup();
  const again = await mount(stored());
  assert.equal(again.chip().textContent, "Verification off", "a fresh read of the Board shows what the retry saved");
});

test("a save that fails after the menu closed says why under the chip, and in the menu once it opens again", async () => {
  let fail = () => {};
  const { view, chip, menu, toggle } = await mount(true, {
    save: () => new Promise<void>((_resolve, reject) => (fail = () => reject(new Error("bb is restarting")))),
  });
  fireEvent.click(chip());
  fireEvent.click(toggle());
  fireEvent.keyDown(toggle(), { key: "Escape" });
  await waitFor(() => assert.equal(chip().getAttribute("aria-expanded"), "false"));

  await act(async () => fail());
  const below = await view.findByRole("alert");
  assert.match(below.textContent ?? "", /^Couldn't turn verification off: .*bb is restarting/);
  assert.equal(view.queryByRole("dialog"), null, "under the chip, with the menu closed");
  assert.equal(chip().textContent, "Verification on");

  fireEvent.click(chip());
  assert.match(menu().getByRole("alert").textContent ?? "", /^Couldn't turn verification off/);
  assert.equal(view.getAllByRole("alert").length, 1, "in the menu instead, not twice");
});

test("a save that fails with the menu open, then Escape: one alert while the menu animates out, under the chip", async () => {
  // why a stylesheet: the menu stays mounted while its close animation runs, as in bb; jsdom runs no
  // animation, so the menu stays in its closing state for the rest of the test.
  const closing = document.head.appendChild(document.createElement("style"));
  closing.textContent = '.rmi-verify-menu[data-state="closed"] { animation-name: rmi-verify-menu-out; }';
  try {
    const { view, chip, menu, toggle } = await mount(true, { save: () => Promise.reject(new Error("bb is restarting")) });
    fireEvent.click(chip());
    fireEvent.click(toggle());
    await menu().findByRole("alert");
    fireEvent.keyDown(toggle(), { key: "Escape" });
    await waitFor(() => assert.equal(chip().getAttribute("aria-expanded"), "false"));
    assert.ok(document.querySelector('.rmi-verify-menu[data-state="closed"]'), "the menu is still animating out");
    const alerts = view.getAllByRole("alert");
    assert.equal(alerts.length, 1, "one alert");
    assert.equal(alerts[0]?.closest(".rmi-verify-menu"), null, "under the chip, not in the closing menu");
  } finally {
    closing.remove();
  }
});

test("while a save is pending, the chip and the switch show the asked value, dimmed with aria-disabled, and the switch ignores presses", async () => {
  let land = async () => {};
  const { chip, toggle, saves } = await mount(true, {
    save: (_next, store) => new Promise<void>((resolve) => (land = () => store().then(resolve))),
  });
  fireEvent.click(chip());
  fireEvent.click(toggle());
  await waitFor(() => assert.equal(toggle().getAttribute("aria-disabled"), "true"));
  assert.equal(toggle().getAttribute("aria-checked"), "false", "the asked value");
  assert.equal(chip().textContent, "Verification off");
  assert.equal(chip().getAttribute("aria-disabled"), "true");

  fireEvent.click(toggle());
  assert.equal(saves.length, 1, "a press while it saves does nothing");
  fireEvent.click(chip());
  assert.equal(chip().getAttribute("aria-expanded"), "true", "a press on the disabled chip leaves the menu open");

  await land();
  await waitFor(() => assert.equal(toggle().getAttribute("aria-disabled"), "false"));
  assert.equal(toggle().getAttribute("aria-checked"), "false");
  assert.equal(saves.length, 1);
  fireEvent.click(chip());
  assert.equal(chip().getAttribute("aria-expanded"), "false", "once saved, the chip closes it again");
});

test("while a save is pending, Escape still closes the menu, and the disabled chip doesn't open it", async () => {
  const { view, chip, toggle } = await mount(true, { save: () => new Promise<void>(() => {}) });
  fireEvent.click(chip());
  fireEvent.click(toggle());
  await waitFor(() => assert.equal(chip().getAttribute("aria-disabled"), "true"));
  fireEvent.keyDown(toggle(), { key: "Escape" });
  await waitFor(() => assert.equal(chip().getAttribute("aria-expanded"), "false"));
  fireEvent.click(chip());
  assert.equal(chip().getAttribute("aria-expanded"), "false");
  assert.equal(view.queryByRole("dialog"), null);
});
