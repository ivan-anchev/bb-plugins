import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { chatFileIcons } from "./src/chat-file-icons.ts";

export default definePluginApp((app) => {
  app.contentScripts.register(chatFileIcons);
});
