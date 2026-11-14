import "./app.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FIGURE_LANGUAGES, FigureFence } from "./src/figure-fence";

export default definePluginApp((app) => {
  app.slots.experimental_codeFenceRenderer({
    id: "figures",
    languages: FIGURE_LANGUAGES,
    component: FigureFence,
  });
});
