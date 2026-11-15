// Which clicks on a sidebar thread row the tabs ask to take. Pure, so the rule is testable without a DOM.
import type { SidebarGesture } from "../controller/tabs-controller.ts";

type Click = Pick<MouseEvent, "type" | "button" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

const MAIN = 0;
export const MIDDLE = 1;

/**
 * What a click on a row asks of the tabs, or null for a click bb keeps: any click with a modifier, so
 * Cmd/Ctrl-click still opens the thread in a new split pane, and every other button.
 */
export function gestureOf(click: Click): SidebarGesture | null {
  if (click.shiftKey || click.altKey || click.ctrlKey || click.metaKey) return null;
  if (click.type === "click" && click.button === MAIN) return "plain";
  if (click.type === "auxclick" && click.button === MIDDLE) return "newTab";
  return null;
}
