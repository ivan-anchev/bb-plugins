import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ActivityList } from "./src/ui/activity-list.tsx";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "activity",
    title: "Activity",
    description: "Every parent thread from every project in one list, latest first, with pinned threads above it.",
    component: ActivityList,
  });
});
