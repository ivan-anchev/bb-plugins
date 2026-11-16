// Registrations only.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { boardTab } from "./src/app/board/board-tab.tsx";
import { useNeedsYouBadge } from "./src/app/needs-you-badge.ts";
import { CoordinatorPanel, NewButton } from "./src/app/panel/coordinator-panel.tsx";
import { PANEL_ID, PANEL_PATH } from "./src/app/panel/routes.ts";
import { DISPLAY_NAME } from "./src/name.ts";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL_ID,
    title: DISPLAY_NAME,
    icon: "Workflow",
    path: PANEL_PATH,
    component: CoordinatorPanel,
    experimental_useBadge: useNeedsYouBadge,
    headerContent: NewButton,
  });
  app.slots.experimental_tab(boardTab);
});
