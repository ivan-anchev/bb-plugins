// Registration only: one homepage section whose content shows above the new-thread composer.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TodayQuote } from "./quote/TodayQuote.tsx";
import "./quote/quote.css";

export default definePluginApp((app) => {
  app.slots.homepageSection({ id: "quote", title: "The Office", component: TodayQuote });
});
