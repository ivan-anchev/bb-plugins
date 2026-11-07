import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { UiBlock } from "./src/app/ui-block.tsx";
import { UI_BLOCK_LANGUAGES } from "./src/library.ts";

export default definePluginApp((app) => {
  app.slots.experimental_codeFenceRenderer({ id: "ui-block", languages: UI_BLOCK_LANGUAGES, component: UiBlock });
});
