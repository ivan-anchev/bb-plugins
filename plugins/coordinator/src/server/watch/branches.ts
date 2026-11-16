// The branch each crew's thread works on, which the watch finds its pull request by. bb records it
// on the thread; when it doesn't, bb's git plugin reads it from the checkout of the thread's
// environment, on that environment's machine.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The part of `bb--git`'s `status` the watch reads (`bb plugin rpc inspect bb--git status` prints
 * the whole), keyed by environment id: the branch checked out, or null when there is none to read
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

/** A thread as the watch lists it, down to what says its branch. */
type BranchedThread = { id: string; environmentId: string | null; environmentBranchName: string | null };

/** The parts of bb the branch lookup uses. */
export type BranchesBb = {
  log: Pick<PluginLogger, "warn">;
  sdk: { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: { keys: string[] }; outputSchema: z.ZodType<T> }): Promise<T> } };
};

/** Each thread's branch, by thread id: bb's record of it, else its environment's checkout. A thread with neither is left out. */
export async function branchesOf(bb: BranchesBb, threads: Iterable<BranchedThread>): Promise<Map<string, string>> {
  const branches = new Map<string, string>();
  const unrecorded = new Map<string, string>();
  for (const { id, environmentId, environmentBranchName } of threads) {
    if (environmentBranchName !== null) branches.set(id, environmentBranchName);
    else if (environmentId !== null) unrecorded.set(id, environmentId);
  }
  if (unrecorded.size === 0) return branches;
  const checkedOut = await checkedOutBranches(bb, [...new Set(unrecorded.values())]);
  for (const [id, environmentId] of unrecorded) {
    const branch = checkedOut.get(environmentId) ?? null;
    if (branch !== null) branches.set(id, branch);
  }
  return branches;
}

/** The branch each environment has checked out, by environment id. why caught: the git plugin may be off, and the threads bb names a branch for are still read. */
async function checkedOutBranches(bb: BranchesBb, environmentIds: string[]): Promise<Map<string, string | null>> {
  try {
    return new Map(Object.entries(await bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "status", input: { keys: environmentIds }, outputSchema: gitStatusSchema })));
  } catch (error) {
    bb.log.warn(`Could not read the branch of ${environmentIds.join(", ")} from bb's git plugin, so their crews' pull requests aren't read this tick: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}
