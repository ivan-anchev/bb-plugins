// The branch checked out in a crew's environment, as bb's git plugin reads it on that environment's
// machine. Read only as the crew hands off, while it is awake anyway: a read at any other time
// could wake a crew's sandbox, or keep it from idling. why not bb's record alone: bb records the
// branch an environment was made on and keeps it when the crew checks out another.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The part of `bb--git`'s `status` read here (`bb plugin rpc inspect bb--git status` prints the
 * whole), keyed by environment id: the branch checked out, or null when there is none to read
 * (detached, unborn, unknown, not a git environment, or its machine couldn't be read).
 */
const gitStatusSchema = z.record(
  z.string(),
  z.union([
    z
      .object({ outcome: z.literal("available"), workspace: z.object({ checkout: z.object({ kind: z.literal("branch"), branchName: z.string().min(1) }) }) })
      .transform(({ workspace }) => workspace.checkout.branchName),
    z.object({ outcome: z.string() }).transform(() => null),
  ]),
);

/** The parts of bb the read uses. */
export type CheckedOutBranchBb = {
  log: Pick<PluginLogger, "warn">;
  sdk: { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: { keys: string[] }; outputSchema: z.ZodType<T> }): Promise<T> } };
};

/** The branch the environment has checked out; null when bb's git plugin can't say. why caught: the git plugin may be off, and the crew's branch then stays as recorded. */
export async function checkedOutBranch(bb: CheckedOutBranchBb, environmentId: string): Promise<string | null> {
  try {
    const rows = await bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "status", input: { keys: [environmentId] }, outputSchema: gitStatusSchema });
    return rows[environmentId] ?? null;
  } catch (error) {
    bb.log.warn(`Could not read the branch of ${environmentId} from bb's git plugin, so its crew's branch stays as recorded: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
