import {
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { tabs } from "../controller/tabs.ts";
import type { Nav } from "../controller/tabs-controller.ts";
import { useScreen } from "../host/screen.ts";
import { useStripSlot } from "../host/strip-mount.ts";
import { savedTabs } from "../model/saved.ts";
import { Strip } from "./strip.tsx";

export function TabsOverlay() {
  const pluginId = experimental_usePluginId();
  const nav = useLatestNav();
  const { threadId } = useBbContext();
  const screen = useScreen(threadId);
  const split = useSidebarSplitLayout();
  const threads = experimental_useSidebarThreads();
  const slot = useStripSlot();

  useEffect(() => tabs.bind(nav, savedTabs(pluginId)), [nav, pluginId]);
  useEffect(() => tabs.observe(screen), [split, threadId, screen]);
  useEffect(() => {
    if (threads.status === "ready") tabs.syncThreads(threads);
  }, [threads]);

  return slot === null ? null : createPortal(<Strip />, slot);
}

function useLatestNav(): Nav {
  const nav = useBbNavigate();
  const latest = useRef(nav);
  useLayoutEffect(() => {
    latest.current = nav;
  });
  return useMemo(
    () => ({
      toThread: (...args) => latest.current.toThread(...args),
      toCompose: (...args) => latest.current.toCompose(...args),
    }),
    [],
  );
}
