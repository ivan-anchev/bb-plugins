// What bb says about an environment the plugin can't otherwise see into without waking it.

/** The part of bb the read uses. */
export type EnvironmentsBb = { sdk: { environments: { get(args: { environmentId: string }): Promise<{ status: string }> } } };

/** Whether bb has destroyed the environment, as when a sandbox is removed: no turn can run there again. */
export async function environmentGone(bb: EnvironmentsBb, environmentId: string): Promise<boolean> {
  return (await bb.sdk.environments.get({ environmentId })).status === "destroyed";
}
