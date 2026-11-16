// The window's one React owner of the strip (an experimental_appOverlay, mounted once per window with the
// SDK's hooks). Feeds bb's changes into the controller and portals the strip into the content script's slot.
import {
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { tabs } from "../controller/tabs.ts";
import { useScreen } from "../host/screen.ts";
import { useStripSlot } from "../host/strip-mount.ts";
import { savedTabs } from "../model/saved.ts";
import { Strip } from "./strip.tsx";

export function TabsOverlay() {
  const pluginId = experimental_usePluginId();
  const nav = useBbNavigate();
  const { threadId } = useBbContext();
  const screen = useScreen(threadId);
  const split = useSidebarSplitLayout();
  const threads = experimental_useSidebarThreads();
  const slot = useStripSlot();

  // Declared first, so the saved tabs are loaded and the navigator bound before the first observe. The
  // unbind stops tab writes and saves.
  useEffect(() => tabs.bind(nav, savedTabs(pluginId)), [nav, pluginId]);
  // why `split` and `threadId`: `split` changes on every pane focus, layout change and divider drag, the
  // route thread on every navigation between threads, and `screen` between a thread, bb's New thread screen
  // and Settings. Together they are the signal that bb's layout or route changed; the tree is read from bb.
  useEffect(() => tabs.observe(screen), [split, threadId, screen]);
  // why only once ready: a loading or failed index has no threads, which must not read as all of them gone.
  useEffect(() => {
    if (threads.status === "ready") tabs.syncThreads(threads);
  }, [threads]);

  return slot === null ? null : createPortal(<Strip />, slot);
}
