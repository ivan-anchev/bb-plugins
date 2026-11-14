// Composition root: wires the modules and owns no logic of its own.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { trackActivity } from "./src/activity.ts";
import { createBoatAccess } from "./src/boat/access.ts";
import { createStartGate } from "./src/boat/start-gate.ts";
import { boatHostsRpcHandlers } from "./src/boat-hosts.ts";
import { launchRpcHandlers } from "./src/catalog/read.ts";
import { boatCli } from "./src/cli.ts";
import { boatSandboxContract, PROVIDER_ID } from "./src/contract.ts";
import { createIdleClock } from "./src/idle-clock.ts";
import { boatMachineProvider } from "./src/machine-provider.ts";
import { loadOwnerId } from "./src/ownership.ts";
import { describeProblems } from "./src/problem.ts";
import { defineBoatSettings } from "./src/settings.ts";
import { createSpendCard, spendCardRpcHandlers } from "./src/spend/card.ts";
import { createSweep } from "./src/sweep/run.ts";

// Bounds plugin load when boat is slow; `bb boat status` reads again on demand.
const STARTUP_CHECK_TIMEOUT_MS = 10_000;
// Ends a spend reading well before the next one is due.
const SPEND_READING_TIMEOUT_MS = 60_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const boat = createBoatAccess(defineBoatSettings(bb));
  const ownerId = await loadOwnerId(bb.storage.kv);
  const idle = createIdleClock(bb.storage.kv);
  bb.cli.register(boatCli({ boat, machineEnvironment: () => bb.sdk.system.machineEnvironment() }, { bb, idle, ownerId }));
  const spend = createSpendCard({ access: boat, kv: bb.storage.kv, ownerId });
  bb.rpc.register(boatSandboxContract, {
    ...launchRpcHandlers(boat),
    ...boatHostsRpcHandlers(bb.sdk.hosts),
    ...spendCardRpcHandlers(spend),
  });

  bb.experimental_machines.register(
    boatMachineProvider({
      access: boat,
      gate: createStartGate(),
      ownerId,
      idle,
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

  trackActivity(bb, idle);
  bb.background.schedule("reconcile-sandboxes", "* * * * *", createSweep({ bb, access: boat, idle, ownerId }));
  // The spend chart's days come only from these readings (and the card's own): boat keeps no daily history.
  bb.background.schedule("record-spend", "*/5 * * * *", () => spend.sample(AbortSignal.timeout(SPEND_READING_TIMEOUT_MS)));

  const configuration = await boat.configuration(AbortSignal.timeout(STARTUP_CHECK_TIMEOUT_MS));
  if (configuration.status !== "available") bb.status.needsConfiguration(describeProblems(configuration.problems));
}
