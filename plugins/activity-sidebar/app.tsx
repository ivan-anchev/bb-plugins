import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SLEEP_ICON, WAKE_ICON } from "./src/model/sleep-action.ts";
import { ActivityList } from "./src/ui/activity-list.tsx";
import { sleepGlyph } from "./src/ui/row/sleep-glyphs.tsx";
import "./app.css";

export default definePluginApp((app) => {
  // why: Sleep and Wake in bb's thread menu name their glyphs; bb's icon set has neither.
  app.experimental_icons.register({ name: SLEEP_ICON, component: ({ className }) => sleepGlyph("Moon", className) });
  app.experimental_icons.register({ name: WAKE_ICON, component: ({ className }) => sleepGlyph("Sun", className) });
  app.slots.experimental_threadList({
    id: "activity",
    title: "Activity",
    description: "Every parent thread from every project in one list, latest first, with pinned threads above it.",
    component: ActivityList,
  });
});
