import type { HostLayout, Nav } from "../../controller/tabs-controller.ts";
import { focused, panes, type Layout } from "../../model/layout.ts";
import { paneIdsOnScreen } from "../screen.ts";
import { withCaretInFocusedPane } from "./composer-focus.ts";
import { currentLayoutAtom, locateLayoutAtom } from "./layout-atom.ts";
import { rebuildPaneByPane } from "./pane-by-pane.ts";
import { readStored } from "./stored-layout.ts";
import { untilFrame } from "./until-frame.ts";

const SHOW_TIMEOUT_MS = 2000;

let warned = false;

export const hostLayout: HostLayout = {
  read() {
    const atom = currentLayoutAtom();
    return atom === null ? readStored() : atom.read();
  },

  /**
   * Resolves once bb shows `layout`, with the caret in its focused pane's composer: "exact" from bb's layout
   * atom, else "equal-splits" rebuilt pane by pane. Rejects when bb does not show it in time, and with the
   * signal's reason once it aborts.
   */
  show(layout, nav, signal) {
    return withCaretInFocusedPane(() => place(layout, nav, signal), signal);
  },
};

async function place(layout: Layout, nav: Nav, signal: AbortSignal): Promise<"exact" | "equal-splits"> {
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
}

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
    case "plugin-panel":
    case "plugin-detail":
      return;
    default:
      content satisfies never;
      return;
  }
}

function onScreen(layout: Layout, signal: AbortSignal): Promise<void> {
  const ids = panes(layout).map((pane) => pane.paneId);
  const shown = () => {
    const onScreen = paneIdsOnScreen();
    return ids.every((id) => onScreen.has(id));
  };
  return untilFrame(shown, "show the layout", SHOW_TIMEOUT_MS, signal);
}
