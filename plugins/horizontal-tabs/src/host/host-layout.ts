// The controller's one port to bb's layout. Reads bb's live tree; shows a tab's layout by writing bb's layout
// atom (layout-atom.ts), then routes to its focused pane so the URL, the sidebar and useBbContext follow
// (layout-restore L5 step 4: writing the atom does not touch the URL).
// why sessionStorage: until the atom is located, bb's own copy of the tree is the one place to read it. bb
// persists it under this key on every change, in the format layoutSchema copies.
// why the pane DOM: bb takes 60-300 ms to render a written layout, and clicks land meanwhile. A show lasts
// until bb's panes carry the written ids, so the controller coalesces those clicks into one more write.
import type { HostLayout, Nav } from "../controller/tabs-controller.ts";
import { focused, layoutSchema, panes, type Layout } from "../model/layout.ts";
import { currentLayoutAtom, locateLayoutAtom } from "./layout-atom.ts";
import { paneIdsOnScreen } from "./screen.ts";
import { z } from "zod";

const KEY = "bb.splitLayout";
const SHOW_TIMEOUT_MS = 2000;
const storedSchema = z.strictObject({ version: z.literal(1), layout: layoutSchema });

export const hostLayout: HostLayout = {
  read() {
    const atom = currentLayoutAtom();
    return atom === null ? readStored() : atom.read();
  },

  /**
   * Resolves once bb shows `layout`; rejects with the reason when bb's layout atom can't be located, and with
   * the signal's reason once it aborts.
   */
  async show(layout, nav, signal) {
    const atom = await locateLayoutAtom();
    signal.throwIfAborted();
    atom.write(layout);
    routeTo(layout, nav);
    await onScreen(layout, signal);
  },
};

function routeTo(layout: Layout, nav: Nav): void {
  const content = focused(layout).content;
  switch (content.kind) {
    case "thread":
      return nav.toThread(content.threadId);
    case "new-thread":
      return nav.toCompose();
    // A plugin page has no route of its own here; bb's route reconcile leaves the written pane alone.
    case "plugin-panel":
    case "plugin-detail":
      return;
    default:
      content satisfies never;
      // why: a newer bb may store a pane kind this plugin doesn't know; leave the route as it is.
      return;
  }
}

/** Resolves on the first frame bb's panes carry every pane id of `layout`; stops looking once `signal` aborts. */
function onScreen(layout: Layout, signal: AbortSignal): Promise<void> {
  const ids = panes(layout).map((pane) => pane.paneId);
  const deadline = performance.now() + SHOW_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      reject(signal.reason);
    };
    const settle = (done: () => void) => {
      signal.removeEventListener("abort", stop);
      done();
    };
    const check = () => {
      const shown = paneIdsOnScreen();
      if (ids.every((id) => shown.has(id))) settle(resolve);
      else if (performance.now() > deadline) settle(() => reject(new Error(`bb did not show the layout within ${SHOW_TIMEOUT_MS} ms`)));
      else frame = requestAnimationFrame(check);
    };
    signal.addEventListener("abort", stop, { once: true });
    check();
  });
}

function readStored(): Layout | null {
  // Missing before bb's first layout; bb writes an empty string when it clears its layout.
  const stored = sessionStorage.getItem(KEY);
  if (stored === null) return null;
  const parsed = storedSchema.safeParse(decode(stored));
  return parsed.success ? parsed.data.layout : null;
}

/** The stored JSON, or undefined (which the schema rejects) when it is empty or malformed. */
function decode(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}
