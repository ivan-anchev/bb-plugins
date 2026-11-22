import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createElement as h, Fragment, useState } from "react";
import { boardTag, coordinatorContract as contract, type Board, type Coordinator, type IssueRow } from "../../contract.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";

// Issue links in chat, driven as bb renders them and as the user meets them: a message whose Markdown
// holds a link to an issue shows the issue's live glyph and id, mid-sentence; hovering or focusing it
// shows the Board's card for the issue, floating in the window by the link; pressing it opens the
// issue's tab in its regional manager's thread. The message here is React's, as bb's is, so a
// re-render does to the link what bb's does.

// why: jsdom has none; the card's lines measure their titles.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const { issueLinks } = await import("./issue-links.tsx");
const { paneMarker } = await import("./panes.tsx");

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const COORDINATOR_ID = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const MANAGER_THREAD = "thr_manager";
const AGENT_THREAD = "thr_agent";
const COORDINATOR: Coordinator = { id: COORDINATOR_ID, threadId: MANAGER_THREAD, projectId: "prj_1", description: null, avatar: { kind: "icon", icon: "Workflow" } };
const HREF = (id: string) => `/plugins/regional-manager/regional-managers/issue/${COORDINATOR_ID}/${id}`;

function issue(raw: string, fields: Partial<IssueRow>): IssueRow {
  return { id: issueIdSchema.parse(raw), kind: "build", parentId: null, subIssues: null, blockedBy: [], blocks: [], title: `Issue ${raw}`, status: "todo", needsYou: null, headline: null, agent: null, pr: null, ...fields };
}

type Chat = { panes: readonly string[]; linkKey?: string; label?: string };

/**
 * bb's window, as the overlay sees it: the overlay, and a pane per thread, each with its header row's
 * marker and one assistant message. `linkKey` and `label`: the first link's key and text, which a
 * re-render changes; `declines`: how many opens the side panel declines first. Counts the message's renders.
 */
function mount(chat: Chat, { declines = 0 } = {}) {
  let issues = [issue("BBP-24", { title: "Inline issue links", status: "in-progress", headline: "Working", blocks: [issueIdSchema.parse("BBP-27")] }), issue("BBP-27", { title: "Avatars", blockedBy: [issueIdSchema.parse("BBP-24")] })];
  const renders = { count: 0 };
  const Message = ({ linkKey = "first", label = "BBP-24" }: Omit<Chat, "panes">) => {
    renders.count++;
    return h(
      "div",
      { "data-markdown-preview": "" },
      h("p", null, "Status check: ", h("a", { key: linkKey, href: HREF("BBP-24") }, label), " is waiting on ", h("a", { href: HREF("BBP-27") }, "BBP-27"), ". In code: ", h("code", null, `[BBP-24](${HREF("BBP-24")})`), ", and bare: BBP-24.", " Elsewhere: ", h("a", { href: "https://example.com/BBP-24" }, "a page")),
    );
  };
  /** Shows the window as `chat` says now: a test changes it as bb would, by rendering again. */
  const shown: { set(chat: Chat): void } = { set: () => assert.fail("not mounted") };
  const Window = (first: Chat) => {
    const [{ panes, ...message }, set] = useState(first);
    shown.set = set;
    return h(Fragment, null, h(issueLinks.component, {}), ...panes.map((threadId) => h("section", { key: threadId, "data-thread": threadId }, h(paneMarker.component, { threadId, projectId: "prj_1", environment: null }), h(Message, message))));
  };
  const board = (): Board => ({ verify: true, ownEdits: null, prUnavailable: null, decisions: [], issues });
  const view = renderSlot({ component: Window }, chat, {
    pluginId: "regional-manager",
    experimental_rpcContract: contract,
    rpc: { coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }), board },
    // why it can decline: bb declines an open in a pane it hasn't focused yet, as a split it just added as it mounts.
    experimental_panel: { openTab: () => declines-- <= 0 },
  });
  const pane = (threadId: string) => view.container.querySelector<HTMLElement>(`[data-thread="${threadId}"]`) ?? assert.fail(`no pane ${threadId}`);
  const link = (threadId: string, id = "BBP-24") => pane(threadId).querySelector<HTMLAnchorElement>(`a[href="${HREF(id)}"]`) ?? assert.fail(`no link to ${id}`);
  /** The glyph drawn in the link, by what it says. */
  const glyphOf = (anchor: HTMLAnchorElement) => anchor.querySelector(".rmi-issue-glyph [role=img]")?.getAttribute("aria-label") ?? null;
  const card = () => document.body.querySelector<HTMLElement>(".rmi-card-floating");
  const setStatus = async (id: string, fields: Partial<IssueRow>) => {
    issues = issues.map((row) => (row.id === id ? { ...row, ...fields } : row));
    await view.behavior.experimental_invalidateRpc([boardTag(COORDINATOR_ID)]);
  };
  const show = (next: Chat) => act(() => shown.set(next));
  return { view, pane, link, glyphOf, card, renders, setStatus, show };
}

test("an issue link in a message shows its issue's glyph before its id, mid-sentence; a link in code, a bare id and another link stay as they are", async () => {
  const { view, link, glyphOf } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  assert.equal(glyphOf(link(MANAGER_THREAD, "BBP-27")), "Todo");
  // why the space optional: jsdom's name trims each element's text, the space after the glyph included, where Chrome keeps it.
  assert.equal(view.getByRole("link", { name: /^In progress ?BBP-24$/ }), link(MANAGER_THREAD), "the link says the issue's status, then its id");

  const message = view.container.querySelector("[data-markdown-preview] p") ?? assert.fail("no message");
  assert.equal(message.textContent, `Status check:  BBP-24 is waiting on  BBP-27. In code: [BBP-24](${HREF("BBP-24")}), and bare: BBP-24. Elsewhere: a page`, "the sentence reads as it did, each issue link a space wider before its id");
  assert.deepEqual(
    [...view.container.querySelectorAll(".rmi-issue-glyph")].map((slot) => slot.parentElement?.getAttribute("href")),
    [HREF("BBP-24"), HREF("BBP-27")],
    "only the issue links have a glyph: nothing in code, in bare text or in another link",
  );
});

test("the glyph follows the board as it changes, while the message doesn't render again", async () => {
  const { link, glyphOf, renders, setStatus } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  const rendered = renders.count;

  await setStatus("BBP-24", { status: "in-review" });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In review"));
  await setStatus("BBP-24", { needsYou: "Pick a vault" });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "Needs you"));
  assert.equal(renders.count, rendered);
});

test("a link bb renders again, as a new element or with its text replaced, as a streamed reply does, gets its glyph back, once", async () => {
  const { view, link, glyphOf, show } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  const first = link(MANAGER_THREAD);

  show({ panes: [MANAGER_THREAD], linkKey: "second" });
  assert.notEqual(link(MANAGER_THREAD), first, "a new element");
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));

  const second = link(MANAGER_THREAD);
  show({ panes: [MANAGER_THREAD], linkKey: "second", label: "BBP-24 " });
  assert.equal(link(MANAGER_THREAD), second, "the same element, its text replaced");
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  assert.equal(view.container.querySelectorAll(".rmi-issue-glyph").length, 2, "one glyph a link");
});

test("focusing an issue link shows the Board's card for the issue at once, floating outside the message; Escape closes it wherever focus is, holding bb's Escape, and focus stays on the link", async () => {
  const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  act(() => link(MANAGER_THREAD).focus());

  await waitFor(() => assert.ok(card() !== null));
  assert.equal(card()?.parentElement, document.body, "in the window, not in the message list");
  assert.deepEqual([...(card()?.querySelector(".rmi-card-body")?.children ?? [])].map((line) => line.textContent), ["Inline issue links", "In progress", "Working", "Blocks BBP-27", "BlocksBBP-27Avatars"]);

  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => link(MANAGER_THREAD).dispatchEvent(escape));
  assert.equal(card(), null);
  assert.equal(escape.defaultPrevented, true, "bb's own Escape, which leaves the page, skips it");
  assert.ok(document.activeElement === link(MANAGER_THREAD));
});

test("the pointer resting on an issue link opens its card after half a second; crossing onto the card keeps it, and leaving both closes it after a beat", async () => {
  const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  mock.timers.enable({ apis: ["setTimeout"] });
  const anchor = link(MANAGER_THREAD);

  fireEvent.pointerOver(anchor, { relatedTarget: document.body });
  act(() => mock.timers.tick(499));
  assert.equal(card(), null, "not while the pointer only passes");
  act(() => mock.timers.tick(1));
  const shown = card() ?? assert.fail("no card");

  fireEvent.pointerOut(anchor, { relatedTarget: shown });
  fireEvent.pointerOver(shown, { relatedTarget: anchor });
  act(() => mock.timers.tick(1_000));
  assert.equal(card(), shown, "the pointer on the card keeps it");

  fireEvent.pointerOut(shown, { relatedTarget: document.body });
  act(() => mock.timers.tick(149));
  assert.ok(card() !== null, "time to cross back");
  act(() => mock.timers.tick(1));
  assert.equal(card(), null);
});

test("a link's card opens under the link where the window has room, else above it, and keeps off the window's right edge", async () => {
  const cases = [
    { name: "room below", link: { top: 100, bottom: 116, left: 40 }, want: { side: "below", left: "40px", top: "120px" } },
    { name: "the window's foot and right edge", link: { top: 700, bottom: 716, left: 900 }, want: { side: "above", left: `${1024 - 320 - 8}px`, top: `${700 - 4 - 200}px` } },
  ];
  for (const { name, link: box, want } of cases) {
    const restore = laidOut(box, { height: 200, width: 320 });
    try {
      const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
      await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
      act(() => link(MANAGER_THREAD).focus());
      await waitFor(() => assert.ok(card() !== null));
      assert.deepEqual({ side: card()?.dataset.side, left: card()?.style.left, top: card()?.style.top }, want, name);
      cleanup();
    } finally {
      restore();
    }
  }
});

test("the card follows its link as the message scrolls, and stays open", async () => {
  const box = { top: 100, bottom: 116, left: 40 };
  const restore = laidOut(box, { height: 200, width: 320 });
  try {
    const { view, link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
    await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
    act(() => link(MANAGER_THREAD).focus());
    await waitFor(() => assert.equal(card()?.style.top, "120px"));

    Object.assign(box, { top: 60, bottom: 76 });
    act(() => void fireEvent.scroll(view.container.querySelector(`[data-thread="${MANAGER_THREAD}"]`) ?? assert.fail("no pane")));
    assert.equal(card()?.style.top, "80px", "moved with the link");
  } finally {
    restore();
  }
});

test("a capped card's body is the tab stop after its link: Tab on the link goes into it, and Shift+Tab from it goes back to the link", async () => {
  const restore = laidOut({ top: 700, bottom: 716, left: 40 }, { height: 2_000, width: 320 });
  try {
    const { view, link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
    await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
    act(() => link(MANAGER_THREAD).focus());
    const body = await view.findByRole("region", { name: "Details of BBP-24" });

    const tab = (target: Element, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      act(() => void target.dispatchEvent(event));
      return event.defaultPrevented;
    };
    assert.equal(tab(link(MANAGER_THREAD)), true);
    assert.ok(document.activeElement === body, "into the card");
    assert.ok(card() !== null, "the card stays while focus is in it");

    assert.equal(tab(body, true), true);
    assert.ok(document.activeElement === link(MANAGER_THREAD), "back on the link");
    assert.ok(card() !== null);
  } finally {
    restore();
  }
});

/** Every issue link's box at `link`, and the card `card` big, in a 1024 by 768 window. why stubs: jsdom lays nothing out. */
function laidOut(link: { top: number; bottom: number; left: number }, card: { height: number; width: number }): () => void {
  const boxOf = HTMLElement.prototype.getBoundingClientRect;
  const sizes = ["scrollHeight", "offsetWidth"] as const;
  const kept = sizes.map((size) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, size));
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const { top, bottom, left } = this instanceof HTMLAnchorElement ? link : { top: 0, bottom: 0, left: 0 };
    return { top, bottom, left, right: left + 60, x: left, y: top, width: 60, height: bottom - top, toJSON: () => ({}) };
  };
  const isCard = (el: HTMLElement) => el.classList.contains("rmi-card");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get(this: HTMLElement) { return isCard(this) ? card.height : 0; } });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return isCard(this) ? card.width : 0; } });
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = boxOf;
    sizes.forEach((size, i) => {
      const descriptor = kept[i];
      if (descriptor !== undefined) Object.defineProperty(HTMLElement.prototype, size, descriptor);
    });
  };
}

test("pressing an issue link in its regional manager's thread opens the issue's tab in that pane's side panel, titled as the Board titles it, and bb never follows the link", async () => {
  const { view, link, glyphOf } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));

  assert.equal(fireEvent.click(link(MANAGER_THREAD)), false, "bb's own handling of the link is skipped");
  await waitFor(() => assert.deepEqual(view.inspection.experimental_panelCalls, [{ method: "openTab", options: { tab: { id: "issue", context: { kind: "thread" }, availability: "action" }, params: { issueId: "BBP-24" }, title: "BBP-24 Inline issue links" } }]));
  assert.deepEqual(view.inspection.navigateCalls, [{ method: "toThread", threadId: MANAGER_THREAD, options: { split: true } }], "bb's split brings forward the pane that shows the thread, this one");
});

test("pressing an issue link in another thread opens the regional manager's thread in a split, and its pane opens the tab once it shows, asking again after bb declines; ⌘ asks for the split from the manager's thread too", async () => {
  const { view, link, glyphOf, show, setStatus } = mount({ panes: [AGENT_THREAD] }, { declines: 1 });
  await waitFor(() => assert.equal(glyphOf(link(AGENT_THREAD)), "In progress"));
  const opened = () => view.inspection.experimental_panelCalls.map((call) => call.method === "openTab" && call.options.title);

  assert.equal(fireEvent.click(link(AGENT_THREAD, "BBP-27")), false);
  assert.deepEqual(view.inspection.navigateCalls, [{ method: "toThread", threadId: MANAGER_THREAD, options: { split: true } }]);
  assert.deepEqual(opened(), [], "no pane shows the manager's thread yet");

  show({ panes: [AGENT_THREAD, MANAGER_THREAD] });
  await waitFor(() => assert.deepEqual(opened(), ["BBP-27 Avatars"], "the new pane asks, and bb declines"));
  await setStatus("BBP-27", { status: "in-progress" });
  await waitFor(() => assert.deepEqual(opened(), ["BBP-27 Avatars", "BBP-27 Avatars"], "kept, and asked again"));
  await setStatus("BBP-27", { status: "todo" });
  assert.deepEqual(opened(), ["BBP-27 Avatars", "BBP-27 Avatars"], "once opened, never again");

  assert.equal(fireEvent.click(link(MANAGER_THREAD), { metaKey: true }), false);
  assert.deepEqual(view.inspection.navigateCalls.at(-1), { method: "toThread", threadId: MANAGER_THREAD, options: { split: true } });
});
