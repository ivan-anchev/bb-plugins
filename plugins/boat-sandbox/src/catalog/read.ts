// What a thread can launch from: boat's saved snapshots and environments, read with the configured
// key, and the defaults. Validate, create, the chip's RPC, `bb boat status` and `bb boat templates`
// all read through here.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession, Configuration } from "../boat/access.ts";
import type { boatSandboxContract, LaunchChoicesReply } from "../contract.ts";
import { resolveLaunch, type LaunchChoices, type LaunchResolution, type MachineInputs } from "../launch.ts";
import { describeProblems } from "../problem.ts";

/** Throws boat's error when a list read fails (a `ci` key has `snapshot.read` and `environment.read`). */
export async function readLaunchChoices({ client, settings }: BoatSession, signal?: AbortSignal): Promise<LaunchChoices> {
  const [templates, environments] = await Promise.all([client.savedSnapshots(signal), client.environments(signal)]);
  return { templates, environments, defaults: settings.defaults };
}

/**
 * The chip's RPC and `bb boat templates --json`. `unavailable` only when nothing can launch until the
 * settings change; any read that fails (boat's account or a list) throws, which the chip shows
 * without blocking.
 */
export async function readLaunchChoicesReply(configuration: Configuration, signal?: AbortSignal): Promise<LaunchChoicesReply> {
  switch (configuration.status) {
    case "available":
      return { status: "ready", ...(await readLaunchChoices(configuration, signal)) };
    case "setup-required":
    case "refused":
      return { status: "unavailable", message: describeProblems(configuration.problems) };
    case "read-failed":
      throw new Error(configuration.problems[0].message);
    default:
      return configuration satisfies never;
  }
}

/** The inputs resolved against what boat has now. */
export async function resolveOnBoat(session: BoatSession, inputs: MachineInputs, signal: AbortSignal): Promise<LaunchResolution> {
  return resolveLaunch(inputs, await readLaunchChoices(session, signal));
}

export const launchRpcHandlers = (access: BoatAccess): ExperimentalPluginRpcHandlersWithContext<typeof boatSandboxContract> => ({
  launchChoices: async (_input, { experimental_signal: signal }) => readLaunchChoicesReply(await access.configuration(signal), signal),
});
