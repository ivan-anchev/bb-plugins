import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { followChromeInset } from "./chrome-inset.ts";

// bb's page as chrome-inset.ts reads it: the rows it pads at the window's top-left, their classes, and the
// observers watching those classes.
type FakeRow = { classList: string[] };
let rows: FakeRow[] = [];
Object.defineProperty(globalThis, "document", { value: { querySelectorAll: () => rows } });

const observers = new Set<FakeObserver>();
class FakeObserver {
  watched = new Set<FakeRow>();
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    observers.add(this);
  }
  observe(row: FakeRow, options: { attributes: boolean; attributeFilter: string[] }): void {
    assert.deepEqual(options, { attributes: true, attributeFilter: ["class"] });
    this.watched.add(row);
  }
  disconnect(): void {
    this.watched.clear();
  }
  /** bb changed `row`'s classes. */
  notify(row: FakeRow): void {
    if (this.watched.has(row)) this.callback();
  }
}
Object.defineProperty(globalThis, "MutationObserver", { value: FakeObserver });

/** bb sets `row`'s classes, as React does on a re-render. */
function setClasses(row: FakeRow, classes: string): void {
  row.classList = classes.split(" ");
  observers.forEach((observer) => observer.notify(row));
}

function row(classes: string): FakeRow {
  return { classList: classes.split(" ") };
}

const TRANSITION = "transition-[padding] duration-200 ease-linear";
const INSET = "pl-[calc(var(--bb-window-title-bar-controls-end)_+_12px)]";
const HEADER = "flex h-(--bb-app-chrome-row-height) items-center relative z-10 gap-1";

/** Follows the inset like strip-mount.ts does, recording each set of classes it hands over. */
function follow() {
  const controller = new AbortController();
  const published: string[] = [];
  const follower = followChromeInset(controller.signal, (classes) => published.push(classes));
  follower.follow();
  return { published, follow: () => follower.follow(), stop: () => controller.abort() };
}

beforeEach(() => {
  rows = [];
  observers.clear();
});

test("the inset comes from the row bb pads, not the first row on the page", () => {
  // A thread's header first in the page, the New thread pane's at the window's top-left after it.
  rows = [row(`${HEADER} ${TRANSITION}`), row(`${HEADER} ${TRANSITION} ${INSET}`)];
  const { published } = follow();
  assert.deepEqual(published, [`${TRANSITION} ${INSET}`]);
});

test("a class change on the row moves the inset, keeping the transition that animates it", () => {
  const header = row(`${HEADER} ${TRANSITION}`);
  rows = [header];
  const { published } = follow();
  setClasses(header, `${HEADER} ${TRANSITION} ${INSET}`); // the sidebar closes
  setClasses(header, `${HEADER} ${TRANSITION}`); // and opens again
  assert.deepEqual(published, [TRANSITION, `${TRANSITION} ${INSET}`, TRANSITION]);
});

test("swapping the header moves the watch to the new row", () => {
  const before = row(`${HEADER} ${TRANSITION} ${INSET}`);
  rows = [before];
  const { published, follow: domChanged } = follow();
  const after = row(`${HEADER} ${TRANSITION}`);
  rows = [after];
  domChanged();
  setClasses(before, `${HEADER} ${TRANSITION}`); // the old row, gone from the page, changes nothing
  setClasses(after, `${HEADER} ${TRANSITION} ${INSET}`);
  assert.deepEqual(published, [`${TRANSITION} ${INSET}`, TRANSITION, `${TRANSITION} ${INSET}`]);
});

test("with no row on the page, the last inset stays", () => {
  rows = [row(`${HEADER} ${TRANSITION} ${INSET}`)];
  const { published, follow: domChanged } = follow();
  rows = [];
  domChanged();
  assert.deepEqual(published, [`${TRANSITION} ${INSET}`]);
});

test("stopping disconnects the watch", () => {
  const header = row(`${HEADER} ${TRANSITION}`);
  rows = [header];
  const { published, stop } = follow();
  stop();
  setClasses(header, `${HEADER} ${TRANSITION} ${INSET}`);
  assert.deepEqual(published, [TRANSITION]);
});
