// The window's one React owner of the strip (an experimental_appOverlay, mounted once per window with the
// SDK's hooks). Feeds bb's changes into the controller and portals the strip into the content script's slot.
import { experimental_useSidebarThreads, useBbContext, useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { tabs } from "../controller/tabs.ts";
import { useStripSlot } from "../host/strip-mount.ts";
import { Strip } from "./strip.tsx";

export function TabsOverlay() {
  const { threadId } = useBbContext();
  const split = useSidebarSplitLayout();
  const threads = experimental_useSidebarThreads();
  const slot = useStripSlot();

  // why `split`: it changes on every pane focus, layout change and divider drag, and the route thread on
  // every navigation. Together they are the signal that bb's layout changed; the tree itself is read from bb.
  useEffect(() => tabs.observe(threadId), [split, threadId]);
  useEffect(() => {
    if (threads.status === "ready") tabs.syncThreads(threads);
  }, [threads]);

  return slot === null ? null : createPortal(<Strip />, slot);
}
