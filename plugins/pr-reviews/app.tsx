import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PrPage } from "./src/app/page/pr-page.tsx";
import { RefreshButton } from "./src/app/page/refresh-button.tsx";
import { useReadyGuidesBadge } from "./src/app/ready-badge.ts";
import { PANEL_PATH } from "./src/app/routes.ts";
import { PrSidebar } from "./src/app/sidebar/pr-sidebar.tsx";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "pr-reviews",
    title: "PR Reviews",
    icon: "GitPullRequest",
    path: PANEL_PATH,
    component: PrPage,
    experimental_sidebar: PrSidebar,
    experimental_useBadge: useReadyGuidesBadge,
    headerContent: RefreshButton,
  });
});
