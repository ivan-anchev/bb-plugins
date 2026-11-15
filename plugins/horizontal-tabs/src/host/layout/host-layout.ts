// The controller's one port to bb's layout. Reads bb's live tree; shows a tab's layout by writing bb's layout
// atom (layout-atom.ts), then routes to its focused pane so the URL, the sidebar and useBbContext follow
// (layout-restore L5 step 4: writing the atom does not touch the URL). When the atom can't be located, it
// rebuilds the tab pane by pane instead (pane-by-pane.ts).
// why the pane DOM: bb takes 60-300 ms to render a written layout, and clicks land meanwhile. A show lasts
// until bb's panes carry the written ids, so the controller coalesces those clicks into one more write.
import type { HostLayout, Nav } from "../../controller/tabs-controller.ts";
import { focused, panes, type Layout } from "../../model/layout.ts";
import { paneIdsOnScreen } from "../screen.ts";
import { currentLayoutAtom, locateLayoutAtom } from "./layout-atom.ts";
import { rebuildPaneByPane } from "./pane-by-pane.ts";
import { readStored } from "./stored-layout.ts";
import { untilFrame } from "./until-frame.ts";

const SHOW_TIMEOUT_MS = 2000;

/** The page warned that it shows tabs at equal sizes. */
let warned = false;

export const hostLayout: HostLayout = {
  read() {
    const atom = currentLayoutAtom();
    return atom === null ? readStored() : atom.read();
  },

  /**
   * Resolves once bb shows `layout`: "exact" from bb's layout atom, else "equal-splits" rebuilt pane by pane.
   * Rejects when bb does not show it in time, and with the signal's reason once it aborts.
   */
  async show(layout, nav, signal) {
    const atom = await locateLayoutAtom().catch((error: unknown) => {
      warnOnce(error);
      return null;
    });
    signal.throwIfAborted();
    if (atom === null) {
      await rebuildPaneByPane(layout, nav, signal);
      return "equal-splits";
    }
    atom.write(layout);
    routeTo(layout, nav);
    await onScreen(layout, signal);
    return "exact";
  },
};

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[horizontal-tabs] bb's layout atom can't be located, so tabs show their panes at equal sizes:", error);
}

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
  const shown = () => {
    const onScreen = paneIdsOnScreen();
    return ids.every((id) => onScreen.has(id));
  };
  return untilFrame(shown, "show the layout", SHOW_TIMEOUT_MS, signal);
}
