// Sidebar row clicks into tabs. Only the clicks the tabs take are prevented; every other click keeps bb's own
// rule (focus the thread's pane if the split shows it, else open it in the focused pane; Cmd/Ctrl-click opens
// it in a new split pane).
// why: bb has no hook to intercept opening a thread from the sidebar. bb's list and the Activity sidebar both
// put the documented `data-sidebar-thread-id` on each row's link, and a capture-phase listener on the
// document sees the click before either list routes it; preventDefault() there stops the routing in both.
// Nothing stops propagation, so the lists' own handlers (Activity's drawer close, double-click rename) run.
import type { PluginContentScriptRegistration } from "@get-bb/plugin-sdk/app";
import { tabs } from "../controller/tabs.ts";
import { gestureOf, MIDDLE } from "./sidebar-gesture.ts";
import { stripShown } from "./strip-mount.ts";

const ROW = "[data-sidebar-thread-id]";
const CONTROL = "button,[role=button],[role=menuitem]";

export const sidebarClicks: PluginContentScriptRegistration = {
  id: "sidebar-clicks",
  mount({ signal }) {
    const options = { capture: true, signal };
    // auxclick: the browser would open the row's link in a new browser tab on a middle-click.
    document.addEventListener("click", route, options);
    document.addEventListener("auxclick", route, options);
    // The browser would start autoscrolling.
    document.addEventListener(
      "mousedown",
      (event) => {
        if (event.button === MIDDLE && rowThread(event) !== null) event.preventDefault();
      },
      options,
    );
  },
};

function route(event: MouseEvent): void {
  const gesture = gestureOf(event);
  if (gesture === null) return;
  const threadId = rowThread(event);
  if (threadId !== null && tabs.routeSidebarClick(threadId, gesture)) event.preventDefault();
}

/**
 * The thread of the row the click landed on. Null off rows, on a control inside a row (its own action), and
 * while the strip is hidden, where there are no tabs to route into.
 */
function rowThread(event: MouseEvent): string | null {
  if (!stripShown() || !(event.target instanceof Element)) return null;
  const row = event.target.closest(ROW);
  if (row === null) return null;
  const control = event.target.closest(CONTROL);
  if (control !== null && control !== row && row.contains(control)) return null;
  return row.getAttribute("data-sidebar-thread-id");
}
