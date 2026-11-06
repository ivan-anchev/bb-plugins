// Registration only: the strip above each thread composer.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RosterBanner } from "./ui/RosterBanner.tsx";
import "./roster.css";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "roster",
    // why: only thread composers have delegates.
    scopes: ["thread"],
    // why: the collapsed strip has no fill or border, so no host card chrome.
    banners: [{ id: "roster", chrome: "bare", component: RosterBanner }],
  });
});
