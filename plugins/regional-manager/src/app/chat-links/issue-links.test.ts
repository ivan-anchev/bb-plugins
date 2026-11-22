import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { useBbContext, type BbContext } from "@get-bb/plugin-sdk/app";
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

type Chat = { panes: readonly string[]; linkKey?: string; label?: string; href?: string };

/**
 * bb's window, as the overlay sees it: the overlay, and a pane per thread, each with its header row's
 * marker and one assistant message. `linkKey`, `label` and `href`: the first link's key, text and
 * href, which a re-render changes. `focused`: the thread the app has focused, as bb's route says it;
 * given, the side panel declines an open while that isn't the manager's thread, as bb does for a
 * pane it hasn't focused. `board`: whether the board reads, fails, or never answers. Counts the
 * message's renders.
 */
function mount(chat: Chat, { focused, board: reading = "reads" }: { focused?: string; board?: "reads" | "fails" | "pending" } = {}) {
  let issues = [issue("BBP-24", { title: "Inline issue links", status: "in-progress", headline: "Working", blocks: [issueIdSchema.parse("BBP-27")] }), issue("BBP-27", { title: "Avatars", blockedBy: [issueIdSchema.parse("BBP-24")] })];
  const renders = { count: 0 };
  const Message = ({ linkKey = "first", label = "BBP-24", href = HREF("BBP-24") }: Omit<Chat, "panes">) => {
    renders.count++;
    return h(
      "div",
      { "data-markdown-preview": "" },
      h("p", null, "Status check: ", h("a", { key: linkKey, href }, label), " is waiting on ", h("a", { href: HREF("BBP-27") }, "BBP-27"), ". In code: ", h("code", null, `[BBP-24](${HREF("BBP-24")})`), ", and bare: BBP-24.", " Elsewhere: ", h("a", { href: "https://example.com/BBP-24" }, "a page")),
    );
  };
  /** Shows the window as `chat` says now: a test changes it as bb would, by rendering again. */
  const shown: { set(chat: Chat): void; now: Chat } = { set: () => assert.fail("not mounted"), now: chat };
  /** The fake's selection, the one object its useBbContext gives every render: a test moves its focus by changing it, as bb's route does. */
  const context: { current: BbContext | null } = { current: null };
  const Selection = () => {
    context.current = useBbContext();
    return null;
  };
  const Window = (first: Chat) => {
    const [{ panes, ...message }, set] = useState(first);
    shown.set = set;
    return h(Fragment, null, h(Selection), h(issueLinks.component, {}), ...panes.map((threadId) => h("section", { key: threadId, "data-thread": threadId }, h(paneMarker.component, { threadId, projectId: "prj_1", environment: null }), h(Message, message))));
  };
  const boardState = { reading };
  /** The tabs the side panel opened, by title: the opens it accepted. */
  const opened: string[] = [];
  const board = (): Board | Promise<Board> => {
    if (boardState.reading === "fails") throw new Error("bb is restarting");
    if (boardState.reading === "pending") return new Promise<Board>(() => {});
    return { verify: true, ownEdits: null, prUnavailable: null, decisions: [], issues };
  };
  const view = renderSlot({ component: Window }, chat, {
    pluginId: "regional-manager",
    experimental_rpcContract: contract,
    rpc: { coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }), board },
    ...(focused === undefined ? {} : { context: { threadId: focused } }),
    // why it can decline: bb declines an open in a pane it hasn't focused yet, as a split it just added as it mounts.
    experimental_panel: {
      openTab: ({ title }) => {
        const accepted = focused === undefined || context.current?.threadId === MANAGER_THREAD;
        if (accepted) opened.push(title ?? "");
        return accepted;
      },
    },
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
  const show = (next: Chat) => {
    shown.now = next;
    act(() => shown.set(next));
  };
  /** bb focuses another thread: the selection changes and the window renders again, nothing else. */
  const focusThread = (threadId: string) => {
    const selection = context.current ?? assert.fail("no selection read");
    selection.threadId = threadId;
    act(() => shown.set({ ...shown.now }));
  };
  /** The board's next read fails, as when bb restarts. */
  const failBoard = async () => {
    boardState.reading = "fails";
    await view.behavior.experimental_invalidateRpc([boardTag(COORDINATOR_ID)]);
  };
  return { view, pane, link, glyphOf, card, renders, setStatus, show, focusThread, failBoard, opened };
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

test("a slot bb takes out of a link it keeps comes back, with its glyph", async () => {
  const { link, glyphOf } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  const anchor = link(MANAGER_THREAD);
  act(() => anchor.querySelector(".rmi-issue-glyph")?.remove());
  assert.equal(glyphOf(anchor), null);
  await waitFor(() => assert.equal(glyphOf(anchor), "In progress"));
});

test("a link whose href bb changes in place to another address loses its glyph", async () => {
  const { view, link, glyphOf, show } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  const anchor = link(MANAGER_THREAD);

  show({ panes: [MANAGER_THREAD], href: "https://example.com/elsewhere" });
  assert.equal(anchor.getAttribute("href"), "https://example.com/elsewhere", "the same element");
  await waitFor(() => assert.equal(anchor.querySelector(".rmi-issue-glyph"), null));
  assert.equal(view.container.querySelectorAll(".rmi-issue-glyph").length, 1, "only BBP-27's is left");
});

test("when bb renders the focused link again, as a reply streams, focus moves to the link that replaced it, not the page, and its card with it", async () => {
  const { link, glyphOf, card, show } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  const first = link(MANAGER_THREAD);
  act(() => first.focus());
  await waitFor(() => assert.ok(card() !== null));

  show({ panes: [MANAGER_THREAD], linkKey: "streamed" });
  assert.ok(link(MANAGER_THREAD) !== first, "a new element");
  await waitFor(() => assert.ok(document.activeElement === link(MANAGER_THREAD), "focus is on the link that replaced it"));
  await waitFor(() => assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links"));
});

test("focus in a link's capped card stays with the link when bb renders it again: it moves to the link that replaced it, not the page", async () => {
  const restore = laidOut({ top: 700, bottom: 716, left: 40 }, { height: 2_000, width: 320 });
  try {
    const { view, link, glyphOf, show } = mount({ panes: [MANAGER_THREAD] });
    await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
    const first = link(MANAGER_THREAD);
    act(() => first.focus());
    act(() => view.getByRole("region", { name: "Details of BBP-24" }).focus());

    show({ panes: [MANAGER_THREAD], linkKey: "streamed" });
    assert.ok(link(MANAGER_THREAD) !== first);
    await waitFor(() => assert.ok(document.activeElement === link(MANAGER_THREAD), "on the link that replaced it"));
  } finally {
    restore();
  }
});

test("a link the user moved focus away from doesn't take it back when bb renders it again", async () => {
  const { link, glyphOf, card, show } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  act(() => link(MANAGER_THREAD).focus());
  await waitFor(() => assert.ok(card() !== null));
  act(() => link(MANAGER_THREAD).blur());
  await waitFor(() => assert.ok(card() === null));

  show({ panes: [MANAGER_THREAD], linkKey: "streamed" });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(document.activeElement === document.body, "focus stays where the user left it");
  assert.ok(card() === null);
});

test("when the shown link stops being an issue link, its card goes, and Escape is bb's again", async () => {
  const { link, glyphOf, card, show } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  act(() => link(MANAGER_THREAD).focus());
  await waitFor(() => assert.ok(card() !== null));

  show({ panes: [MANAGER_THREAD], href: "https://example.com/elsewhere" });
  await waitFor(() => assert.ok(card() === null));
  await act(async () => {});
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => void document.body.dispatchEvent(escape));
  assert.equal(escape.defaultPrevented, false);
});

test("a focused link whose card shows nothing, as its issue isn't on the board or the board isn't read yet, leaves Escape to bb", async () => {
  for (const [name, chat, options] of [
    ["an issue the board has none of", { panes: [MANAGER_THREAD], href: HREF("BBP-999"), label: "BBP-999" }, {}],
    ["a board not read yet", { panes: [MANAGER_THREAD] }, { board: "pending" }],
  ] as const) {
    const { link, glyphOf, card } = mount(chat, options);
    if (!("board" in options)) await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD, "BBP-27")), "Todo", "the board is read"));
    const anchor = name === "a board not read yet" ? link(MANAGER_THREAD) : link(MANAGER_THREAD, "BBP-999");
    await waitFor(() => assert.ok(anchor.querySelector(".rmi-issue-glyph") !== null));
    act(() => anchor.focus());
    assert.ok(card() === null, name);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void anchor.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, false, name);
    cleanup();
  }
});

test("a focused link whose card shows nothing holds no card against the pointer: hovering another link opens that link's card", async () => {
  const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD], href: HREF("BBP-999"), label: "BBP-999" });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD, "BBP-27")), "Todo"));
  await waitFor(() => assert.ok(link(MANAGER_THREAD, "BBP-999").querySelector(".rmi-issue-glyph") !== null));
  act(() => link(MANAGER_THREAD, "BBP-999").focus());
  assert.ok(card() === null);

  mock.timers.enable({ apis: ["setTimeout"] });
  fireEvent.pointerOver(link(MANAGER_THREAD, "BBP-27"), { relatedTarget: document.body });
  act(() => mock.timers.tick(1_000));
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Avatars");
});

test("while the board can't be read, a link draws no glyph, which would show a status no longer vouched for", async () => {
  const { link, glyphOf, failBoard } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  await failBoard();
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), null));
});

test("a refresh of the board that fails while a card shows keeps its details and says it couldn't refresh", async () => {
  const { link, glyphOf, card, failBoard } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  act(() => link(MANAGER_THREAD).focus());
  await waitFor(() => assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links"));

  await failBoard();
  await waitFor(() => assert.equal(card()?.querySelector(".rmi-card-failure")?.textContent, "Couldn't refresh: bb is restarting"));
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links", "the details it had stay");
});

test("hovering another link leaves the card of the link that has focus, while it shows, and shows its own once focus goes", async () => {
  const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  act(() => link(MANAGER_THREAD).focus());
  await waitFor(() => assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links"));

  mock.timers.enable({ apis: ["setTimeout"] });
  fireEvent.pointerOver(link(MANAGER_THREAD, "BBP-27"), { relatedTarget: document.body });
  act(() => mock.timers.tick(1_000));
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links", "the focused link's card stays");
  fireEvent.pointerOut(link(MANAGER_THREAD, "BBP-27"), { relatedTarget: document.body });
  act(() => mock.timers.tick(1_000));
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links");

  fireEvent.pointerOver(link(MANAGER_THREAD, "BBP-27"), { relatedTarget: document.body });
  act(() => link(MANAGER_THREAD).blur());
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Avatars", "focus gone, the card of the link the pointer rests on shows");
  fireEvent.pointerOut(link(MANAGER_THREAD, "BBP-27"), { relatedTarget: document.body });
  act(() => mock.timers.tick(1_000));
  act(() => link(MANAGER_THREAD).focus());
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Inline issue links");

  act(() => void link(MANAGER_THREAD).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.ok(card() === null);
  fireEvent.pointerOver(link(MANAGER_THREAD, "BBP-27"), { relatedTarget: document.body });
  act(() => mock.timers.tick(500));
  assert.equal(card()?.querySelector(".rmi-card-title")?.textContent, "Avatars", "once Escape put the focused link's card away, hovering opens another's");
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
  assert.ok(card() === null);
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
  assert.ok(card() === null, "not while the pointer only passes");
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
  assert.ok(card() === null);
});

test("a link's card opens under the link where the window has room, else above it, and keeps off the window's right edge", async () => {
  const cases = [
    { name: "room below", link: { top: 100, bottom: 116, left: 40 }, want: { side: "below", left: "40px", top: "120px", bottom: "" } },
    { name: "the window's foot and right edge", link: { top: 700, bottom: 716, left: 900 }, want: { side: "above", left: `${1024 - 320 - 8}px`, bottom: `${768 - 700 + 4}px` } },
  ];
  for (const { name, link: box, want } of cases) {
    const restore = laidOut(box, { height: 200, width: 320 });
    try {
      const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
      await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
      act(() => link(MANAGER_THREAD).focus());
      await waitFor(() => assert.ok(card() !== null));
      assert.deepEqual({ side: card()?.dataset.side, left: card()?.style.left, ...(want.side === "below" ? { top: card()?.style.top, bottom: card()?.style.bottom } : { bottom: card()?.style.bottom }) }, want, name);
      cleanup();
    } finally {
      restore();
    }
  }
});

test("the card follows its link as the message scrolls, on the side with room, and stays open", async () => {
  const box = { top: 100, bottom: 116, left: 40 };
  const restore = laidOut(box, { height: 200, width: 320 });
  try {
    const { view, link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
    await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
    act(() => link(MANAGER_THREAD).focus());
    await waitFor(() => assert.equal(card()?.style.top, "120px"));

    const pane = view.container.querySelector(`[data-thread="${MANAGER_THREAD}"]`) ?? assert.fail("no pane");
    Object.assign(box, { top: 60, bottom: 76 });
    act(() => void fireEvent.scroll(pane));
    assert.deepEqual([card()?.dataset.side, card()?.style.top], ["below", "80px"], "moved with the link");

    Object.assign(box, { top: 700, bottom: 716 });
    act(() => void fireEvent.scroll(pane));
    assert.deepEqual([card()?.dataset.side, card()?.style.bottom], ["above", `${768 - 700 + 4}px`], "to the side with room, by its foot, once the link nears the window's foot");
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

test("a card measures itself again as the window changes: widened, it stays off the right edge at its new width", async () => {
  const box = { top: 100, bottom: 116, left: 250 };
  const size = { height: 200, width: 284 };
  const restore = laidOut(box, size);
  try {
    Object.assign(window, { innerWidth: 300 });
    const { link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
    await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
    act(() => link(MANAGER_THREAD).focus());
    await waitFor(() => assert.equal(card()?.style.left, "8px"));

    Object.assign(window, { innerWidth: 1440 });
    Object.assign(box, { left: 1300 });
    Object.assign(size, { width: 320 });
    act(() => void window.dispatchEvent(new window.Event("resize")));
    assert.equal(card()?.style.left, `${1440 - 320 - 8}px`, "placed by the width it has now");
  } finally {
    restore();
  }
});

test("a capped card that no longer needs its cap gives focus in its body back to its link", async () => {
  const restore = laidOut({ top: 700, bottom: 716, left: 40 }, { height: 2_000, width: 320 });
  try {
    const { view, link, glyphOf, card } = mount({ panes: [MANAGER_THREAD] });
    await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
    act(() => link(MANAGER_THREAD).focus());
    const body = await view.findByRole("region", { name: "Details of BBP-24" });
    act(() => body.focus());

    Object.assign(window, { innerHeight: 4_000 });
    act(() => void window.dispatchEvent(new window.Event("resize")));
    assert.equal(card()?.querySelector(".rmi-card-body")?.getAttribute("tabindex"), null, "uncapped");
    assert.ok(document.activeElement === link(MANAGER_THREAD), "focus is back on the link, not in a hidden card");
  } finally {
    restore();
  }
});

/** Every issue link's box at `link`, and the card `card` big, in a 1024 by 768 window; a test changes them by changing the objects. why stubs: jsdom lays nothing out. */
function laidOut(link: { top: number; bottom: number; left: number }, card: { height: number; width: number }): () => void {
  const boxOf = HTMLElement.prototype.getBoundingClientRect;
  const sizes = ["scrollHeight", "offsetWidth"] as const;
  const kept = sizes.map((size) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, size));
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const { top, bottom, left } = this instanceof HTMLAnchorElement ? link : { top: 0, bottom: 0, left: 0 };
    return { top, bottom, left, right: left + 60, x: left, y: top, width: 60, height: bottom - top, toJSON: () => ({}) };
  };
  const isCard = (el: HTMLElement) => el.classList.contains("rmi-card");
  // why the body too: a capped card's body scrolls, so its scroll height is the card's whole content.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get(this: HTMLElement) { return isCard(this) || this.classList.contains("rmi-card-body") ? card.height : 0; } });
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
  assert.deepEqual(view.inspection.navigateCalls, [], "it stays in this pane");
});

test("pressing an issue link in another thread opens the manager's thread in a split; bb declines the tab while that pane isn't focused, and the pane opens it once bb focuses it, the board unchanged", async () => {
  const { view, link, glyphOf, show, focusThread, opened } = mount({ panes: [AGENT_THREAD] }, { focused: AGENT_THREAD });
  await waitFor(() => assert.equal(glyphOf(link(AGENT_THREAD)), "In progress"));
  const asked = () => view.inspection.experimental_panelCalls.filter((call) => call.method === "openTab").length;
  const boardReads = () => view.inspection.rpcCalls.filter(({ method }) => method === "board").length;

  assert.equal(fireEvent.click(link(AGENT_THREAD, "BBP-27")), false);
  assert.deepEqual(view.inspection.navigateCalls, [{ method: "toThread", threadId: MANAGER_THREAD, options: { split: true } }]);
  show({ panes: [AGENT_THREAD, MANAGER_THREAD] });
  await waitFor(() => assert.ok(asked() > 0, "the new pane asks"));
  assert.deepEqual(opened, [], "and bb declines: the pane isn't focused");
  const reads = boardReads();

  focusThread(MANAGER_THREAD);
  await waitFor(() => assert.deepEqual(opened, ["BBP-27 Avatars"], "asked again as bb focused the pane, and opened"));
  focusThread(AGENT_THREAD);
  focusThread(MANAGER_THREAD);
  assert.deepEqual(opened, ["BBP-27 Avatars"], "once opened, never again");
  assert.equal(boardReads(), reads, "the board was not read again: only the focus moved");
});

test("a press with ⌘ or Ctrl, even in the manager's own pane, asks bb for the manager's thread in a split, and the pane showing it opens the tab", async () => {
  const { view, link, glyphOf } = mount({ panes: [MANAGER_THREAD] });
  await waitFor(() => assert.equal(glyphOf(link(MANAGER_THREAD)), "In progress"));
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) assert.equal(fireEvent.click(link(MANAGER_THREAD), modifier), false, "bb's own handling of the link is skipped");
  assert.deepEqual(view.inspection.navigateCalls, [
    { method: "toThread", threadId: MANAGER_THREAD, options: { split: true } },
    { method: "toThread", threadId: MANAGER_THREAD, options: { split: true } },
  ]);
  await waitFor(() => assert.deepEqual(view.inspection.experimental_panelCalls.map((call) => call.method === "openTab" && call.options.title), ["BBP-24 Inline issue links", "BBP-24 Inline issue links"], "once a press"));
});

test("a link to an issue its manager's board has none of still opens the issue's tab, by its id, where the tab says so", async () => {
  const { view, link } = mount({ panes: [MANAGER_THREAD], href: HREF("BBP-999"), label: "BBP-999" });
  // why: with no glyph to wait for, the press is made until the plugin knows the link's manager; bb's own handling (here a stand-in, as jsdom can't follow a link) has the presses before that.
  let reachedBb = false;
  const bbs = (event: Event) => {
    reachedBb = true;
    event.preventDefault();
  };
  document.addEventListener("click", bbs);
  try {
    await waitFor(() => {
      reachedBb = false;
      fireEvent.click(link(MANAGER_THREAD, "BBP-999"));
      assert.equal(reachedBb, false, "caught");
    });
  } finally {
    document.removeEventListener("click", bbs);
  }
  await waitFor(() => assert.deepEqual(view.inspection.experimental_panelCalls.map((call) => call.method === "openTab" && call.options.title), ["BBP-999"]));
});

test("while the board can't be read, a press still opens the issue's tab, by its id, where the tab shows the failure and Retry", async () => {
  const { view, link } = mount({ panes: [MANAGER_THREAD] }, { board: "fails" });
  // why: with no glyph to wait for, the press is made until the plugin knows the link's manager; bb's own handling (here a stand-in, as jsdom can't follow a link) has the presses before that.
  let reachedBb = false;
  const bbs = (event: Event) => {
    reachedBb = true;
    event.preventDefault();
  };
  document.addEventListener("click", bbs);
  try {
    await waitFor(() => {
      reachedBb = false;
      fireEvent.click(link(MANAGER_THREAD));
      assert.equal(reachedBb, false, "caught");
    });
  } finally {
    document.removeEventListener("click", bbs);
  }
  await waitFor(() => assert.deepEqual(view.inspection.experimental_panelCalls.map((call) => call.method === "openTab" && call.options.title), ["BBP-24"]));
});
