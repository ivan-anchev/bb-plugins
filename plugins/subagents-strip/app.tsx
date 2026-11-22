import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RosterBanner } from "./ui/RosterBanner.tsx";
import { SUBAGENTS_TAB_REGISTRATION } from "./ui/SubagentsTab.tsx";
import "./roster.css";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "roster",
    scopes: ["thread"],
    banners: [{ id: "roster", chrome: "bare", component: RosterBanner }],
  });
  app.slots.experimental_tab(SUBAGENTS_TAB_REGISTRATION);
});
