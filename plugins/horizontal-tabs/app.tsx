import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { registerTabCommands } from "./src/controller/commands.ts";
import { sidebarClicks } from "./src/host/sidebar-clicks.ts";
import { stripMount } from "./src/host/strip-mount.ts";
import { TabsOverlay } from "./src/ui/tabs-overlay.tsx";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register(stripMount);
  app.contentScripts.register(sidebarClicks);
  app.slots.experimental_appOverlay({ id: "tabs", component: TabsOverlay });
  registerTabCommands(app.commands);
});
