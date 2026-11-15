// Registrations only.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CoordinatorPanel, NewButton } from "./src/app/panel/coordinator-panel.tsx";
import { PANEL_ID, PANEL_PATH } from "./src/app/panel/routes.ts";
import { DISPLAY_NAME } from "./src/name.ts";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: PANEL_ID, title: DISPLAY_NAME, icon: "Workflow", path: PANEL_PATH, component: CoordinatorPanel, headerContent: NewButton });
});
