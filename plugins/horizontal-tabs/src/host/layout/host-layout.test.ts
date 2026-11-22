import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { Nav } from "../../controller/tabs-controller.ts";
import { single, type Layout } from "../../model/layout.ts";
import { hostLayout } from "./host-layout.ts";

const stored = new Map<string, string>();
const storage: Pick<Storage, "getItem"> = { getItem: (key) => stored.get(key) ?? null };
Object.defineProperty(globalThis, "sessionStorage", { value: storage });

beforeEach(() => stored.clear());

const alpha = single({ kind: "thread", projectId: "proj_a", threadId: "thr_alpha" }, "pane-1");

test("reads the layout bb stored", () => {
  stored.set("bb.splitLayout", JSON.stringify({ version: 1, layout: alpha }));
  assert.deepEqual(hostLayout.read(), alpha);
});

test("reads no layout before bb stores one, or after bb clears it", () => {
  assert.equal(hostLayout.read(), null);
  stored.set("bb.splitLayout", "");
  assert.equal(hostLayout.read(), null);
});

test("reads no layout from a stored value that is not JSON", () => {
  stored.set("bb.splitLayout", '{"version":1,"layout":');
  assert.equal(hostLayout.read(), null);
});

test("reads no layout from a stored layout in another format", () => {
  stored.set("bb.splitLayout", JSON.stringify({ version: 2, layout: alpha }));
  assert.equal(hostLayout.read(), null);
});

const assets = join(await mkdtemp(join(tmpdir(), "ht-bb-")), "assets");
await mkdir(assets);
await writeFile(
  join(assets, "boot-vendor-test.js"),
  `let s;
const f = () => {
  const values = new Map();
  return { writes: [], get: (atom) => (values.has(atom) ? values.get(atom) : atom.init), set(atom, value) { values.set(atom, value); this.writes.push(value); } };
};
export function g(){return s||=f(),s}`,
);
await writeFile(
  join(assets, "index-test.js"),
  `export const layoutAtom = { init: ${JSON.stringify(alpha)}, read() {}, write() {} };`,
);
const chunks = ["boot-vendor-test.js", "index-test.js"].map((name) => ({ src: pathToFileURL(join(assets, name)).href }));
const bbStore: { writes: unknown[] } = (await import(chunks[0].src)).g();

let paneIds: string[] = [];
const page = {
  querySelectorAll: (selector: string) =>
    selector === "script[src]" ? chunks : paneIds.map((id) => ({ getAttribute: () => id })),
};
Object.defineProperty(globalThis, "document", { value: page });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: true }) });
const frames = new Map<number, () => void>();
let lastFrame = 0;
Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: (callback: () => void) => (frames.set(++lastFrame, callback), lastFrame),
});
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: (frame: number) => frames.delete(frame) });

const bravo = single({ kind: "thread", projectId: "proj_a", threadId: "thr_bravo" }, "t2-1");

function recordingNav(routes: string[]): Nav {
  return { toThread: (threadId) => routes.push(threadId), toCompose: () => routes.push("compose") };
}

async function nextFrameRequest(): Promise<void> {
  for (let tick = 0; frames.size === 0; tick += 1) {
    assert.ok(tick < 100, "show() asked for no frame");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function bbStores(layout: Layout): void {
  stored.set("bb.splitLayout", JSON.stringify({ version: 1, layout }));
}

test("a show aborted while bb's layout atom is being located neither writes nor routes", async () => {
  bbStores(alpha);
  const routes: string[] = [];
  const abort = new AbortController();
  const shown = hostLayout.show(bravo, recordingNav(routes), abort.signal);
  abort.abort();
  await assert.rejects(shown, { name: "AbortError" });
  assert.deepEqual(bbStore.writes, []);
  assert.deepEqual(routes, []);
});

test("a show aborted while waiting for bb's panes stops looking for them", async () => {
  bbStores(alpha);
  paneIds = ["pane-1"];
  const routes: string[] = [];
  const abort = new AbortController();
  const shown = hostLayout.show(bravo, recordingNav(routes), abort.signal);
  await nextFrameRequest();
  assert.deepEqual(bbStore.writes, [bravo]);
  assert.deepEqual(routes, ["thr_bravo"]);
  abort.abort();
  await assert.rejects(shown, { name: "AbortError" });
  assert.equal(frames.size, 0);
});

test("a show resolves on the frame bb's panes carry the written ids", async () => {
  paneIds = ["t2-1"];
  const abort = new AbortController();
  let done = false;
  const shown = hostLayout.show(alpha, recordingNav([]), abort.signal).then(() => (done = true));
  await nextFrameRequest();
  paneIds = ["pane-1"];
  frames.forEach((check, frame) => (frames.delete(frame), check()));
  await shown;
  assert.ok(done);
  assert.equal(frames.size, 0);
});
