// What bb shows, read from its panes on screen.
// why: no SDK hook tells bb's New thread screen from Settings. Neither route has a thread, and bb keeps the
// split layout it had underneath both. Settings, like bb's other full pages, takes the place of bb's split
// workspace, so whether any of bb's panes is on screen tells them apart.
import { useSyncExternalStore } from "react";
import type { Screen } from "../controller/tabs-controller.ts";

const PANE = "data-split-pane-id";

/** What bb's route shows; `threadId` is the route's thread (useBbContext), null off thread routes. */
export function useScreen(threadId: string | null): Screen {
  const workspace = useSyncExternalStore(subscribe, () => document.querySelector(`[${PANE}]`) !== null);
  if (threadId !== null) return "thread";
  return workspace ? "workspace" : "page";
}

/** The ids of bb's panes on screen now. */
export function paneIdsOnScreen(): Set<string | null> {
  return new Set(Array.from(document.querySelectorAll(`[${PANE}]`), (pane) => pane.getAttribute(PANE)));
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
