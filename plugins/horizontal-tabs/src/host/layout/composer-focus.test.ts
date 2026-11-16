import assert from "node:assert/strict";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { single, type Layout } from "../../model/layout.ts";
import { withCaretInFocusedPane } from "./composer-focus.ts";

// bb's page as composer-focus.ts reads it: its stored layout, its panes and their composers, the element with
// focus, animation frames, and whether the pointer is coarse.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { value: { getItem: (key: string) => stored.get(key) ?? null } });
let coarsePointer = false;
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: coarsePointer }) });

type FakeElement = { matches(selector: string): boolean; focus(): void };
type FakePane = { getAttribute(name: string): string | null; querySelector(selector: string): FakeElement | null };
type FakePage = EventTarget & { activeElement: FakeElement | null; querySelectorAll(selector: string): unknown[] };

let panes: FakePane[] = [];
const isComposerSelector = (selector: string) => selector.includes("contenteditable");
const page: FakePage = Object.assign(new EventTarget(), {
  activeElement: null,
  querySelectorAll: (selector: string) =>
    isComposerSelector(selector) ? panes.flatMap((pane) => pane.querySelector(selector) ?? []) : panes,
});
Object.defineProperty(globalThis, "document", { value: page });

// Animation frames: callbacks run in the order they were asked for, as browsers do.
let frameRequests = new Map<number, () => void>();
let lastRequest = 0;
Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: (callback: () => void) => (frameRequests.set(++lastRequest, callback), lastRequest),
});
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: (request: number) => frameRequests.delete(request) });

/** The browser renders the next animation frame. */
function frame(): void {
  const callbacks = frameRequests;
  frameRequests = new Map();
  callbacks.forEach((callback) => callback());
}

/** `element` takes focus, as the browser reports it: one focusin, naming the element that lost focus. */
function focusOn(element: FakeElement): void {
  if (page.activeElement === element) return;
  const relatedTarget = page.activeElement;
  page.activeElement = element;
  page.dispatchEvent(Object.assign(new Event("focusin"), { relatedTarget }));
}

/** An element outside bb's composers, such as a tab of the strip or a pane's button. */
function control(): FakeElement {
  const element: FakeElement = { matches: () => false, focus: () => focusOn(element) };
  return element;
}

type Pane = {
  /** bb mounts the pane's composer, a new element each time, and asks for the next frame to focus it in. */
  mount(): FakeElement;
  /** bb mounts the pane's composer without focusing it, as when the sidebar's rename field has focus. */
  mountUnfocused(): FakeElement;
};

/** A pane `paneId`, its composer not mounted yet. */
function pane(paneId: string): Pane {
  let composer: FakeElement | null = null;
  panes.push({ getAttribute: () => paneId, querySelector: (selector) => (isComposerSelector(selector) ? composer : null) });
  function mountUnfocused(): FakeElement {
    const mounted: FakeElement = { matches: isComposerSelector, focus: () => focusOn(mounted) };
    composer = mounted;
    return mounted;
  }
  return {
    mount() {
      const mounted = mountUnfocused();
      requestAnimationFrame(() => mounted.focus());
      return mounted;
    },
    mountUnfocused,
  };
}

/** bb mounts the pane's composer, which focuses itself in the next frame. */
function mountsAndFocuses(pane: Pane): FakeElement {
  const composer = pane.mount();
  frame();
  return composer;
}

/** A show still running, until `finish`. */
function showing(signal: AbortSignal) {
  let finish = () => {};
  const shown = withCaretInFocusedPane(() => new Promise<void>((resolve) => (finish = resolve)), signal);
  return { shown, finish };
}

function bbFocuses(paneId: string): void {
  const children = ["pane-1", "pane-2", "pane-3"].map((id) => single({ kind: "thread", projectId: "proj_a", threadId: `thr_${id}` }, id).root);
  const layout: Layout = { root: { type: "split", dir: "row", sizes: [0.5, 0.25, 0.25], children }, focusedPaneId: paneId };
  stored.set("bb.splitLayout", JSON.stringify({ version: 1, layout }));
}

let alpha: Pane, bravo: Pane, charlie: Pane;
let abort: AbortController;

beforeEach(() => {
  panes = [];
  frameRequests = new Map();
  page.activeElement = null;
  coarsePointer = false;
  [alpha, bravo, charlie] = ["pane-1", "pane-2", "pane-3"].map(pane);
  // Alpha | Bravo | Charlie, Bravo focused.
  bbFocuses("pane-2");
  abort = new AbortController();
});

// The owner's unbind: ends the correction, its frames and its backstop.
afterEach(() => abort.abort());

test("composers that mount together and focus themselves in the next frame all go back to the focused pane's", () => {
  showing(abort.signal);
  const bravoComposer = bravo.mount();
  [alpha, charlie].forEach((pane) => pane.mount());
  frame();
  assert.equal(page.activeElement, bravoComposer);
});

test("as bb's composers focus themselves in turn, each focus goes back to the focused pane's at once", () => {
  showing(abort.signal);
  const [, bravoComposer] = [alpha, bravo].map(mountsAndFocuses);
  assert.equal(page.activeElement, bravoComposer);
  mountsAndFocuses(charlie);
  assert.equal(page.activeElement, bravoComposer);
});

test("a focus on a composer right after it mounts, before bb's, is left alone, and bb's focus elsewhere goes back to it", () => {
  showing(abort.signal);
  const [alphaComposer] = [alpha, bravo, charlie].map((pane) => pane.mount());
  // Assistive tech, or another script, moves focus into Alpha's new composer before the next frame.
  alphaComposer.focus();
  assert.equal(page.activeElement, alphaComposer);
  frame();
  assert.equal(page.activeElement, alphaComposer);
});

test("a focus on a composer after the frame bb focuses it in is left alone", () => {
  showing(abort.signal);
  mountsAndFocuses(bravo);
  const alphaComposer = alpha.mountUnfocused();
  frame();
  frame();
  alphaComposer.focus();
  assert.equal(page.activeElement, alphaComposer);
});

test("a focus on a composer in its frame, once bb's focus there went back, is left alone", () => {
  showing(abort.signal);
  mountsAndFocuses(bravo);
  const alphaComposer = alpha.mount();
  // A script focuses Alpha's composer from its own frame callback, after bb's.
  requestAnimationFrame(() => alphaComposer.focus());
  frame();
  assert.equal(page.activeElement, alphaComposer);
});

test("a composer on screen before the show is left alone", () => {
  const [alphaComposer] = [alpha, bravo].map((pane) => pane.mountUnfocused());
  showing(abort.signal);
  frame();
  alphaComposer.focus();
  assert.equal(page.activeElement, alphaComposer);
});

test("while the show still adds panes, a composer in a pane added later is still corrected", () => {
  const all = panes;
  // bb's fallback rebuilds the layout pane by pane: Bravo's first.
  panes = [all[1]];
  showing(abort.signal);
  const bravoComposer = mountsAndFocuses(bravo);
  frame();
  panes = all;
  mountsAndFocuses(alpha);
  assert.equal(page.activeElement, bravoComposer);
});

test("a composer mounting long after the show, while a pane still lacks one, is still corrected", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { shown, finish } = showing(abort.signal);
  const bravoComposer = mountsAndFocuses(bravo);
  finish();
  await shown;
  t.mock.timers.tick(9_000);
  mountsAndFocuses(alpha);
  assert.equal(page.activeElement, bravoComposer);
});

test("a composer that focuses itself before the focused pane has one keeps focus until that one mounts", () => {
  showing(abort.signal);
  const charlieComposer = mountsAndFocuses(charlie);
  assert.equal(page.activeElement, charlieComposer);
  const bravoComposer = mountsAndFocuses(bravo);
  assert.equal(page.activeElement, bravoComposer);
});

test("once every pane's composer is past the frame bb focuses it in, nothing more is corrected", async () => {
  const { shown, finish } = showing(abort.signal);
  [alpha, bravo, charlie].forEach(mountsAndFocuses);
  finish();
  await shown;
  frame();
  const remounted = mountsAndFocuses(charlie);
  assert.equal(page.activeElement, remounted);
});

test("a pane that never gets a composer stops the correction after a backstop", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { shown, finish } = showing(abort.signal);
  [alpha, bravo].forEach(mountsAndFocuses);
  finish();
  await shown;
  t.mock.timers.tick(10_000);
  const charlieComposer = mountsAndFocuses(charlie);
  assert.equal(page.activeElement, charlieComposer);
});

test("focus the user moves by the keyboard is left alone, and a composer mounting later gives it back", () => {
  showing(abort.signal);
  const [alphaComposer, bravoComposer] = [alpha, bravo].map(mountsAndFocuses);
  assert.equal(page.activeElement, bravoComposer);
  // bb's Focus chat pane 1 (Ctrl+Shift+1), or assistive tech, moves focus into Alpha's composer.
  page.dispatchEvent(Object.assign(new Event("keydown"), { key: "1", ctrlKey: true, shiftKey: true }));
  alphaComposer.focus();
  assert.equal(page.activeElement, alphaComposer);
  mountsAndFocuses(charlie);
  assert.equal(page.activeElement, alphaComposer);
});

test("focus the user moves off the composers, such as to a tab, is left alone and given back", () => {
  showing(abort.signal);
  mountsAndFocuses(bravo);
  const tab = control();
  tab.focus();
  assert.equal(page.activeElement, tab);
  mountsAndFocuses(alpha);
  assert.equal(page.activeElement, tab);
});

test("once the user's focus leaves where they put it, a composer's focus goes to the focused pane's again", () => {
  showing(abort.signal);
  const bravoComposer = mountsAndFocuses(bravo);
  control().focus();
  page.activeElement = null;
  mountsAndFocuses(alpha);
  assert.equal(page.activeElement, bravoComposer);
});

test("the focused pane is read at each focus, so a pane the user focuses gets it", () => {
  showing(abort.signal);
  const [alphaComposer] = [alpha, bravo].map(mountsAndFocuses);
  // A click on Alpha's pane: bb focuses the pane, and focus leaves the composer for the page.
  bbFocuses("pane-1");
  page.activeElement = null;
  mountsAndFocuses(charlie);
  assert.equal(page.activeElement, alphaComposer);
});

test("an aborted show corrects nothing and asks for no more frames", () => {
  showing(abort.signal);
  mountsAndFocuses(bravo);
  abort.abort();
  const charlieComposer = charlie.mount();
  assert.equal(frameRequests.size, 1);
  frame();
  assert.equal(page.activeElement, charlieComposer);
});

test("the next show takes over from the last, without the focus the user moved during it", () => {
  showing(abort.signal);
  const bravoComposer = mountsAndFocuses(bravo);
  control().focus();
  showing(abort.signal);
  mountsAndFocuses(alpha);
  assert.equal(page.activeElement, bravoComposer);
});

test("on a touch screen, where bb's composers don't focus themselves, nothing is corrected", () => {
  coarsePointer = true;
  showing(abort.signal);
  mountsAndFocuses(bravo);
  const alphaComposer = mountsAndFocuses(alpha);
  assert.equal(page.activeElement, alphaComposer);
});
