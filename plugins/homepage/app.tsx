// Registration only: the homepage's grid of cards under the new-thread composer.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { HomeSection } from "./HomeSection.tsx";
import "./homepage.css";
import "./activity/activity.css";

export default definePluginApp((app) => {
  // why: bb draws this title as an <h2> above every homepage section; homepage.css hides it
  // because each card carries its own header.
  app.slots.homepageSection({ id: "cards", title: "Home", component: HomeSection });
});
