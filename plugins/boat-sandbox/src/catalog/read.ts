// What a thread can launch from: boat's saved snapshots and environments, read with the configured
// key, and the defaults. Validate, create, `bb boat status` and `bb boat templates` all read through here.
import type { BoatSession } from "../boat/access.ts";
import { resolveLaunch, type LaunchChoices, type LaunchResolution, type MachineInputs } from "../launch.ts";

/** Throws boat's error when a list read fails (a `ci` key has `snapshot.read` and `environment.read`). */
export async function readLaunchChoices({ client, settings }: BoatSession, signal?: AbortSignal): Promise<LaunchChoices> {
  const [templates, environments] = await Promise.all([client.savedSnapshots(signal), client.environments(signal)]);
  return { templates, environments, defaults: settings.defaults };
}

/** The inputs resolved against what boat has now. */
export async function resolveOnBoat(session: BoatSession, inputs: MachineInputs, signal: AbortSignal): Promise<LaunchResolution> {
  return resolveLaunch(inputs, await readLaunchChoices(session, signal));
}
