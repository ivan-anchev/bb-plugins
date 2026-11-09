// Composition root: wires the modules and owns no logic of its own.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createBoatAccess } from "./src/boat/access.ts";
import { createStartGate } from "./src/boat/start-gate.ts";
import { boatCli } from "./src/cli.ts";
import { boatMachineProvider, PROVIDER_ID } from "./src/machine-provider.ts";
import { loadOwnerId } from "./src/ownership.ts";
import { describeProblems } from "./src/problem.ts";
import { defineBoatSettings } from "./src/settings.ts";

// Bounds plugin load when boat is slow; `bb boat status` reads again on demand.
const STARTUP_CHECK_TIMEOUT_MS = 10_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const boat = createBoatAccess(defineBoatSettings(bb));
  bb.cli.register(boatCli(boat));

  bb.experimental_machines.register(
    boatMachineProvider({
      access: boat,
      gate: createStartGate(),
      ownerId: await loadOwnerId(bb.storage.kv),
      bootstrap: (request) => bb.experimental_machines.bootstrap(request),
    }),
  );
  bb.experimental_environments.register({
    id: PROVIDER_ID,
    displayName: "boat Sandbox",
    description: "A new boat.dev sandbox with this project checked out.",
    icon: "./boat.svg",
    machineProviderId: PROVIDER_ID,
    // Core clones the project and runs .bb-env-setup.sh on the new machine, as for Modal.
    environmentProviderId: "project-checkout",
  });

  const configuration = await boat.configuration(AbortSignal.timeout(STARTUP_CHECK_TIMEOUT_MS));
  if (configuration.status !== "available") bb.status.needsConfiguration(describeProblems(configuration.problems));
}
