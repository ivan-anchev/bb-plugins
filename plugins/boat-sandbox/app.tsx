import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SpendCard } from "./src/app/home/spend-card.tsx";
import { LaunchChip } from "./src/app/launch-chip.tsx";
import { BoatRowBadge, useBoatRows } from "./src/app/row-badge.tsx";
import { PROVIDER_ID } from "./src/contract.ts";
import "./src/app/home/spend-card.css";

export default definePluginApp((app) => {
  // bb draws it before the environment chip while boat Sandbox is the selected environment.
  app.slots.experimental_machineProviderInputs({ machineProviderId: PROVIDER_ID, component: LaunchChip });
  // A boat icon on the sidebar row of every thread whose machine is a boat sandbox.
  app.slots.experimental_threadRowMetadata({ id: "boat-sandbox", useData: useBoatRows, component: BoatRowBadge });
  // why: bb draws this title as an <h2> above the section; spend-card.css hides it, the card has its own.
  app.slots.homepageSection({ id: "spend", title: "boat spend", component: SpendCard });
});
