import { useSyncExternalStore } from "react";
import { hostLayout } from "../host/layout/host-layout.ts";
import { createTabsController, type TabsSnapshot } from "./tabs-controller.ts";

export const tabs = createTabsController(hostLayout);

export function useTabs(): TabsSnapshot | null {
  return useSyncExternalStore(tabs.subscribe, tabs.snapshot);
}
