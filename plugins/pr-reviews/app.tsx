import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PrCard } from "./src/app/home/pr-card.tsx";
import { PrPanel } from "./src/app/pr-panel.tsx";
import { RefreshButton } from "./src/app/page/refresh-button.tsx";
import { useReadyGuidesBadge } from "./src/app/ready-badge.ts";
import { reviewChatTab } from "./src/app/review-chat/review-chat-tab.tsx";
import { PANEL_ID, PANEL_PATH } from "./src/app/routes.ts";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL_ID,
    title: "PR Reviews",
    icon: "GitPullRequest",
    path: PANEL_PATH,
    component: PrPanel,
    experimental_useBadge: useReadyGuidesBadge,
    headerContent: RefreshButton,
  });
  app.slots.experimental_tab(reviewChatTab);
  app.slots.homepageSection({ id: "pull-requests", title: "Pull requests", component: PrCard });
});
