import { useSyncExternalStore } from "react";
import type { Screen } from "../controller/tabs-controller.ts";

/** The attribute bb puts on each of its panes on screen, holding the pane id. */
export const PANE = "data-split-pane-id";

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
