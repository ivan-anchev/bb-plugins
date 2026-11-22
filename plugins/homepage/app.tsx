import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Activity } from "./activity/Activity.tsx";
import { Burn } from "./burn/Burn.tsx";
import "./homepage.css";
import "./activity/activity.css";
import "./burn/burn.css";

export default definePluginApp((app) => {
  app.slots.homepageSection({ id: "activity", title: "Activity", component: Activity });
  app.slots.homepageSection({ id: "burn", title: "Burn", component: Burn });
});
