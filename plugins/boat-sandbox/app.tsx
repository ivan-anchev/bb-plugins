import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ComputerCard } from "./src/app/computer/computer-card.tsx";
import { computerTab } from "./src/app/computer/computer-tab.tsx";
import { MONITOR_ICON, MonitorIcon } from "./src/app/computer/monitor-icon.tsx";
import { SpendCard } from "./src/app/home/spend-card.tsx";
import { LaunchChip } from "./src/app/launch-chip.tsx";
import { BoatRowBadge, useBoatRows } from "./src/app/row-badge.tsx";
import { PROVIDER_ID } from "./src/contract.ts";
import "./src/app/home/spend-card.css";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: MONITOR_ICON, component: MonitorIcon });
  // bb draws it before the environment chip while boat Sandbox is the selected environment.
  app.slots.experimental_machineProviderInputs({ machineProviderId: PROVIDER_ID, component: LaunchChip });
  // A boat icon on the sidebar row of every thread whose machine is a boat sandbox.
  app.slots.experimental_threadRowMetadata({ id: "boat-sandbox", useData: useBoatRows, component: BoatRowBadge });
  // why: bb draws this title as an <h2> above the section; spend-card.css hides it, the card has its own.
  app.slots.homepageSection({ id: "spend", title: "boat spend", component: SpendCard });
  // A boat thread's desktop, live and view only: a row in the New tab's Actions, and a card in the Info tab.
  app.slots.experimental_tab(computerTab);
  // why "0_computer": it sorts before bb's own sections, right under the thread's details.
  app.slots.experimental_threadInfoSection({ id: "computer", group: "0_computer", component: ComputerCard });
});
