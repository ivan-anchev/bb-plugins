// Registration only: the strip above each thread composer, and the one
// side-panel tab: Subagents, the thread's list, which the strip's previous row
// opens, or one subagent's transcript, which a row's Open thread opens.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RosterBanner } from "./ui/RosterBanner.tsx";
import { SUBAGENTS_TAB_REGISTRATION } from "./ui/SubagentsTab.tsx";
import "./roster.css";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "roster",
    // why: only thread composers have delegates.
    scopes: ["thread"],
    // why: the collapsed strip has no fill or border, so no host card chrome.
    banners: [{ id: "roster", chrome: "bare", component: RosterBanner }],
  });
  app.slots.experimental_tab(SUBAGENTS_TAB_REGISTRATION);
});
