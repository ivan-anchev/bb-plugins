// Registration only: the content script that owns the strip's slot in bb's DOM, the overlay that owns
// the strip's React, and the keyboard commands that switch tabs.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { registerTabCommands } from "./src/controller/commands.ts";
import { stripMount } from "./src/host/strip-mount.ts";
import { TabsOverlay } from "./src/ui/tabs-overlay.tsx";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register(stripMount);
  app.slots.experimental_appOverlay({ id: "tabs", component: TabsOverlay });
  registerTabCommands(app.commands);
});
