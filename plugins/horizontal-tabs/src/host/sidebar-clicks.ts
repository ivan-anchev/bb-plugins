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
    document.addEventListener("click", route, options);
    document.addEventListener("auxclick", route, options);
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

function rowThread(event: MouseEvent): string | null {
  if (!stripShown() || !(event.target instanceof Element)) return null;
  const row = event.target.closest(ROW);
  if (row === null) return null;
  const control = event.target.closest(CONTROL);
  if (control !== null && control !== row && row.contains(control)) return null;
  return row.getAttribute("data-sidebar-thread-id");
}
