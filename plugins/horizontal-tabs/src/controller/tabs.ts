// This window's tabs, over bb's real layout. Module state, as in notes' popover-store: the overlay reads it
// with useSyncExternalStore, and later the content script and commands, which run outside React, use it too.
import { useSyncExternalStore } from "react";
import { hostLayout } from "../host/host-layout.ts";
import { createTabsController, type TabsSnapshot } from "./tabs-controller.ts";

export const tabs = createTabsController(hostLayout);

export function useTabs(): TabsSnapshot | null {
  return useSyncExternalStore(tabs.subscribe, tabs.snapshot);
}
