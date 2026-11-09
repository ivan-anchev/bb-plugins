// What a thread can launch from: boat's saved snapshots, read with the configured key, and the
// defaults. Validate, create, `bb boat status` and `bb boat templates` all read through here.
import type { BoatSession } from "../boat/access.ts";
import { resolveLaunch, type LaunchChoices, type LaunchResolution, type MachineInputs } from "../launch.ts";

/** Throws boat's error when the list read fails (a `ci` key has `snapshot.read`). */
export async function readLaunchChoices(session: BoatSession, signal?: AbortSignal): Promise<LaunchChoices> {
  return { templates: await session.client.savedSnapshots(signal), defaults: session.settings.defaults };
}

/** The inputs resolved against what boat has now. */
export async function resolveOnBoat(session: BoatSession, inputs: MachineInputs, signal: AbortSignal): Promise<LaunchResolution> {
  return resolveLaunch(inputs, await readLaunchChoices(session, signal));
}
