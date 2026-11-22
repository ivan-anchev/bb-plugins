import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { type ChromeInset, followChromeInset } from "./chrome-inset.ts";

type FakeElement = {
  classList: string[];
  left: number;
  right: number;
  parentElement: FakeElement | null;
  getBoundingClientRect(): { left: number; right: number };
};
function element(classes = ""): FakeElement {
  return {
    classList: classes.split(" "),
    left: 0,
    right: 0,
    parentElement: null,
    getBoundingClientRect() {
      return { left: this.left, right: this.right };
    },
  };
}

let rows: FakeElement[] = [];
let controls: FakeElement[] = [];
let spacer: FakeElement | null = null;
Object.defineProperty(globalThis, "document", {
  value: {
    querySelectorAll: (selector: string) => (selector.includes("app-page-header-content-row") ? rows : controls),
    querySelector: (selector: string) => {
      assert.equal(selector, ".ht-inset");
      return spacer;
    },
  },
});

const classObservers = new Set<FakeClassObserver>();
class FakeClassObserver {
  watched = new Set<FakeElement>();
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    classObservers.add(this);
  }
  observe(row: FakeElement, options: { attributes: boolean; attributeFilter: string[] }): void {
    assert.deepEqual(options, { attributes: true, attributeFilter: ["class"] });
    this.watched.add(row);
  }
  disconnect(): void {
    this.watched.clear();
  }
}
Object.defineProperty(globalThis, "MutationObserver", { value: FakeClassObserver });

const sizeObservers = new Set<FakeSizeObserver>();
class FakeSizeObserver {
  watched = new Set<FakeElement>();
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    sizeObservers.add(this);
  }
  observe(target: FakeElement, options: { box: string }): void {
    assert.deepEqual(options, { box: "border-box" });
    this.watched.add(target);
    this.callback();
  }
  disconnect(): void {
    this.watched.clear();
  }
}
Object.defineProperty(globalThis, "ResizeObserver", { value: FakeSizeObserver });

function setClasses(row: FakeElement, classes: string): void {
  row.classList = classes.split(" ");
  classObservers.forEach((observer) => {
    if (observer.watched.has(row)) observer.callback();
  });
}

function resize(target: FakeElement): void {
  sizeObservers.forEach((observer) => {
    if (observer.watched.has(target)) observer.callback();
  });
}

const TRANSITION = "transition-[padding] duration-200 ease-linear";
const INSET = "pl-[calc(var(--bb-window-title-bar-controls-end)_+_12px)]";
const HEADER = "flex h-(--bb-app-chrome-row-height) items-center relative z-10 gap-1";

function follow() {
  const controller = new AbortController();
  const published: ChromeInset[] = [];
  const follower = followChromeInset(controller.signal, (inset) => published.push(inset));
  follower.follow();
  return { published, follow: () => follower.follow(), stop: () => controller.abort() };
}

const classes = (value: string): ChromeInset => ({ classes: value });
const padding = (value: number): ChromeInset => ({ padding: value });

function titleBar(right: number): FakeElement {
  const bar = element();
  bar.right = right;
  return bar;
}

function renderStrip(left: number): { strip: FakeElement; spacer: FakeElement } {
  const strip = element();
  const rendered = element();
  rendered.left = left;
  rendered.parentElement = strip;
  spacer = rendered;
  return { strip, spacer: rendered };
}

beforeEach(() => {
  rows = [];
  controls = [];
  spacer = null;
  classObservers.clear();
  sizeObservers.clear();
});

test("the inset comes from the row bb pads, not the first row on the page", () => {
  rows = [element(`${HEADER} ${TRANSITION}`), element(`${HEADER} ${TRANSITION} ${INSET}`)];
  const { published } = follow();
  assert.deepEqual(published, [classes(`${TRANSITION} ${INSET}`)]);
});

test("a class change on the row moves the inset, keeping the transition that animates it", () => {
  const header = element(`${HEADER} ${TRANSITION}`);
  rows = [header];
  const { published } = follow();
  setClasses(header, `${HEADER} ${TRANSITION} ${INSET}`);
  setClasses(header, `${HEADER} ${TRANSITION}`);
  assert.deepEqual(published, [classes(TRANSITION), classes(`${TRANSITION} ${INSET}`), classes(TRANSITION)]);
});

test("swapping the header moves the watch to the new row", () => {
  const before = element(`${HEADER} ${TRANSITION} ${INSET}`);
  rows = [before];
  const { published, follow: domChanged } = follow();
  const after = element(`${HEADER} ${TRANSITION}`);
  rows = [after];
  domChanged();
  setClasses(before, `${HEADER} ${TRANSITION}`);
  setClasses(after, `${HEADER} ${TRANSITION} ${INSET}`);
  assert.deepEqual(published, [
    classes(`${TRANSITION} ${INSET}`),
    classes(TRANSITION),
    classes(`${TRANSITION} ${INSET}`),
  ]);
});

test("with no row on the page, the spacer reaches 12px past bb's floating controls", () => {
  controls = [titleBar(178)];
  renderStrip(66);
  const { published } = follow();
  assert.deepEqual(published, [padding(124)]);
});

test("with no row, the inset follows the strip as bb's sidebar moves it, down to none", () => {
  controls = [titleBar(178)];
  const { strip, spacer } = renderStrip(66);
  const { published } = follow();
  for (const left of [120, 190, 336]) {
    spacer.left = left;
    resize(strip);
  }
  assert.deepEqual(published, [padding(124), padding(70), padding(0)]);
});

test("with no row, the inset follows bb's controls as they grow and as bb swaps them", () => {
  const bar = titleBar(178);
  controls = [bar];
  renderStrip(66);
  const { published, follow: domChanged } = follow();
  bar.right = 200;
  resize(bar);
  controls = [titleBar(38)];
  domChanged();
  assert.deepEqual(published, [padding(124), padding(146), padding(0)]);
});

test("with no row, nothing is measured until the strip renders its spacer", () => {
  controls = [titleBar(178)];
  const { published, follow: domChanged } = follow();
  renderStrip(66);
  domChanged();
  assert.deepEqual(published, [padding(124)]);
});

test("a header coming back gives the inset back to its classes and stops measuring", () => {
  controls = [titleBar(178)];
  const { strip, spacer } = renderStrip(66);
  const { published, follow: domChanged } = follow();
  rows = [element(`${HEADER} ${TRANSITION} ${INSET}`)];
  domChanged();
  spacer.left = 336;
  resize(strip);
  assert.deepEqual(published, [padding(124), classes(`${TRANSITION} ${INSET}`)]);
});

test("stopping disconnects every watch", () => {
  const header = element(`${HEADER} ${TRANSITION}`);
  rows = [header];
  const byClasses = follow();
  byClasses.stop();
  byClasses.follow();
  setClasses(header, `${HEADER} ${TRANSITION} ${INSET}`);

  rows = [];
  controls = [titleBar(178)];
  const { strip, spacer } = renderStrip(66);
  const byMeasure = follow();
  byMeasure.stop();
  spacer.left = 336;
  resize(strip);
  assert.deepEqual([...byClasses.published, ...byMeasure.published], [classes(TRANSITION), padding(124)]);
});
