// Registration only: the strip above each thread composer, and the two
// side-panel tabs: Subagents, which its previous row opens, and the transcript
// a row's Open thread opens.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RosterBanner } from "./ui/RosterBanner.tsx";
import { SUBAGENTS_TAB_REGISTRATION } from "./ui/SubagentsTab.tsx";
import { TRANSCRIPT_TAB_REGISTRATION } from "./ui/TranscriptTab.tsx";
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
  app.slots.experimental_tab(TRANSCRIPT_TAB_REGISTRATION);
});
