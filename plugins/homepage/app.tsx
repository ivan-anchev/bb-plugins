// Registration only: homepage's cards under the new-thread composer, each its own section.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Activity } from "./activity/Activity.tsx";
import "./homepage.css";
import "./activity/activity.css";

export default definePluginApp((app) => {
  // why: bb draws this title as an <h2> above every homepage section; homepage.css hides it
  // because the card carries its own header.
  app.slots.homepageSection({ id: "activity", title: "Activity", component: Activity });
});
