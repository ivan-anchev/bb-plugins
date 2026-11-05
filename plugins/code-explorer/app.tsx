import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FilesTab } from "./src/files-tab.tsx";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "files",
    title: "Files",
    icon: "Folder",
    component: FilesTab,
    layout: "flush",
  });
});
