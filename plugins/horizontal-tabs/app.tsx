// Registration only: the content script that owns the strip's slot in bb's DOM, and the overlay that owns
// the strip's React.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { stripMount } from "./src/host/strip-mount.ts";
import { TabsOverlay } from "./src/ui/tabs-overlay.tsx";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register(stripMount);
  app.slots.experimental_appOverlay({ id: "tabs", component: TabsOverlay });
});
