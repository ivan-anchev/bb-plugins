// Composition root: wires the modules and owns no logic of its own.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createBoatAccess } from "./src/boat/access.ts";
import { boatCli } from "./src/cli.ts";
import { defineBoatSettings } from "./src/settings.ts";

// Bounds plugin load when boat is slow; `bb boat status` reads again on demand.
const STARTUP_CHECK_TIMEOUT_MS = 10_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const boat = createBoatAccess(defineBoatSettings(bb));
  bb.cli.register(boatCli(boat));

  const configuration = await boat.configuration(AbortSignal.timeout(STARTUP_CHECK_TIMEOUT_MS));
  if (configuration.status !== "available")
    bb.status.needsConfiguration(configuration.problems.map((problem) => `${problem.message} ${problem.fix}`).join(" "));
}
