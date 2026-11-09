import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { LaunchChip } from "./src/app/launch-chip.tsx";
import { PROVIDER_ID } from "./src/contract.ts";

export default definePluginApp((app) => {
  // bb draws it before the environment chip while boat Sandbox is the selected environment.
  app.slots.experimental_machineProviderInputs({ machineProviderId: PROVIDER_ID, component: LaunchChip });
});
