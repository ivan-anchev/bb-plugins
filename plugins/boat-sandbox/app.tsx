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
  app.slots.experimental_machineProviderInputs({ machineProviderId: PROVIDER_ID, component: LaunchChip });
  app.slots.experimental_threadRowMetadata({ id: "boat-sandbox", useData: useBoatRows, component: BoatRowBadge });
  app.slots.homepageSection({ id: "spend", title: "boat spend", component: SpendCard });
  app.slots.experimental_tab(computerTab);
  app.slots.experimental_threadInfoSection({ id: "computer", group: "0_computer", component: ComputerCard });
});
