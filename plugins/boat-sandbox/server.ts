import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { trackActivity } from "./src/activity.ts";
import { createBoatAccess } from "./src/boat/access.ts";
import { createStartGate } from "./src/boat/start-gate.ts";
import { boatHostsRpcHandlers } from "./src/boat-hosts.ts";
import { launchRpcHandlers } from "./src/catalog/read.ts";
import { boatCli } from "./src/cli.ts";
import { computerRpcHandlers } from "./src/computer/read.ts";
import { boatSandboxContract, PROVIDER_ID } from "./src/contract.ts";
import { createIdleClock } from "./src/idle-clock.ts";
import { boatMachineProvider } from "./src/machine-provider.ts";
import { loadOwnerId } from "./src/ownership.ts";
import { describeProblems } from "./src/problem.ts";
import { defineBoatSettings } from "./src/settings.ts";
import { createSpendCard, spendCardRpcHandlers } from "./src/spend/card.ts";
import { createSweep } from "./src/sweep/run.ts";

const STARTUP_CHECK_TIMEOUT_MS = 10_000;
const SPEND_READING_TIMEOUT_MS = 60_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const boat = createBoatAccess(defineBoatSettings(bb));
  const ownerId = await loadOwnerId(bb.storage.kv);
  const idle = createIdleClock(bb.storage.kv);
  bb.cli.register(boatCli({ boat, machineEnvironment: () => bb.sdk.system.machineEnvironment() }, { bb, idle, ownerId }));
  const spend = createSpendCard({ access: boat, kv: bb.storage.kv, ownerId });
  bb.rpc.register(boatSandboxContract, {
    ...launchRpcHandlers(boat),
    ...boatHostsRpcHandlers(bb.sdk),
    ...spendCardRpcHandlers(spend),
    ...computerRpcHandlers({ sdk: bb.sdk, machines: bb.experimental_machines, access: boat }),
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
    environmentProviderId: "project-checkout",
  });

  trackActivity(bb, idle);
  bb.background.schedule("reconcile-sandboxes", "* * * * *", createSweep({ bb, access: boat, idle, ownerId }));
  bb.background.schedule("record-spend", "*/5 * * * *", () => spend.sample(AbortSignal.timeout(SPEND_READING_TIMEOUT_MS)));

  const configuration = await boat.configuration(AbortSignal.timeout(STARTUP_CHECK_TIMEOUT_MS));
  if (configuration.status !== "available") bb.status.needsConfiguration(describeProblems(configuration.problems));
}
