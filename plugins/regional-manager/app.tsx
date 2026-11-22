// Registrations only.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { boardTab } from "./src/app/board/board-tab.tsx";
import { issueTab } from "./src/app/board/issue-tab/issue-tab.tsx";
import { issueLinks } from "./src/app/chat-links/issue-links.tsx";
import { paneMarker } from "./src/app/chat-links/panes.tsx";
import { useNeedsYouBadge } from "./src/app/needs-you-badge.ts";
import { CoordinatorPanel, NewButton, usePageTitle } from "./src/app/panel/coordinator-panel.tsx";
import { PANEL_ID } from "./src/app/panel/routes.ts";
import { managerSegment } from "./src/app/thread/manager-segment.tsx";
import { PANEL_PATH } from "./src/model/issue/link/issue-link.ts";
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
    experimental_usePageTitle: usePageTitle,
  });
  app.slots.experimental_tab(boardTab);
  app.slots.experimental_tab(issueTab);
  app.slots.experimental_threadContextSegment(managerSegment);
  // Issue links in chat: experimental, on bb's markup (chat-links/).
  app.slots.experimental_appOverlay(issueLinks);
  app.slots.experimental_threadHeaderRow(paneMarker);
});
