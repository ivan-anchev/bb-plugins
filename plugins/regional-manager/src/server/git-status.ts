// An environment's git status, as bb's git plugin reads it on that environment's machine. The
// plugin reads an agent's environment once, as the agent hands off, while it is awake anyway, and the
// regional manager's own as each of its turns ends. why so seldom: a read at any other time could
// wake an agent's sandbox, or keep it from idling. why not bb's record of the branch: bb records the
// branch an environment was made on and keeps it when the agent checks out another.
import { z } from "zod";
import { checkoutOf, type CheckoutRead } from "../model/verdict/checkout.ts";

/** The commit and branch checked out; null for each that bb's git plugin can't name (detached, unborn, unknown). */
const checkoutRowSchema = z.union([
  z.object({ kind: z.literal("branch"), branchName: z.string().min(1), headSha: z.string().min(1).nullable() }).transform(({ branchName, headSha }) => ({ branch: branchName, headSha })),
  z.object({ kind: z.literal("detached"), headSha: z.string().min(1).nullable() }).transform(({ headSha }) => ({ branch: null, headSha })),
  z.object({ kind: z.string() }).transform(() => ({ branch: null, headSha: null })),
]);

/**
 * The part of a `bb--git` `status` row read here (`bb plugin rpc inspect bb--git status` prints the
 * whole). why the last: a newer bb--git can answer an outcome this plugin doesn't know, or a known
 * one in a shape it can't read, and either must read as unread rather than fail.
 */
const statusRowSchema = z.union([
  z.object({
    outcome: z.literal("available"),
    workspace: z.object({
      checkout: checkoutRowSchema,
      workingTree: z.object({ fileCount: z.number().int().min(0), files: z.array(z.object({ path: z.string(), status: z.string() })) }),
      // why optional: only the regional manager's own read names it, in a line, and a row without it must still read.
      // why "" is none: bb--git answers it when it can name no default branch, as in a checkout with no named branch.
      branch: z.object({ defaultBranch: z.string().transform((name) => (name === "" ? null : name)) }).optional(),
    }),
  }),
  z.object({ outcome: z.literal("not_applicable") }),
  z.object({ outcome: z.literal("unavailable"), failure: z.object({ message: z.string() }) }),
  z.object({ outcome: z.literal("failed"), message: z.string() }),
  z.object({ outcome: z.string() }).transform(({ outcome }) => ({ outcome: "unreadable" as const, answered: outcome })),
]);

type StatusRow = z.infer<typeof statusRowSchema>;

/** A changed file in a working tree, as bb's git plugin lists it: its path, and its `git status --short` code. */
type ChangedFile = { path: string; status: string };

/**
 * What bb's git plugin read: the environment's checkout and working tree (`changedFileCount` counts
 * every changed file, `changedFiles` lists at most bb's cap of them) and the default branch it names,
 * that it isn't a git repository, or why it couldn't say.
 */
export type GitStatus =
  | { kind: "read"; branch: string | null; headSha: string | null; changedFiles: ChangedFile[]; changedFileCount: number; defaultBranch: string | null }
  | { kind: "not-git" }
  | { kind: "unread"; reason: string };

/** The parts of bb the read uses. */
export type GitStatusBb = {
  sdk: { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: { keys: string[] }; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T> } };
};

/** The environment's git status; `signal` cancels the read, which then reads as unread. */
export async function gitStatusOf(bb: GitStatusBb, environmentId: string, signal?: AbortSignal): Promise<GitStatus> {
  let rows: Record<string, StatusRow>;
  try {
    rows = await bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "status", input: { keys: [environmentId] }, outputSchema: z.record(z.string(), statusRowSchema), signal });
  } catch (error) {
    // why caught: the git plugin may be off, or the environment's machine unreachable.
    return unread(error instanceof Error ? error.message : String(error));
  }
  // why possibly undefined: bb's git plugin may leave a key out.
  const row: StatusRow | undefined = rows[environmentId];
  if (row === undefined) return unread("bb's git plugin returned no row for it");
  switch (row.outcome) {
    case "available": {
      const { checkout, workingTree, branch } = row.workspace;
      return { kind: "read", ...checkout, changedFiles: workingTree.files, changedFileCount: workingTree.fileCount, defaultBranch: branch?.defaultBranch ?? null };
    }
    case "not_applicable":
      return { kind: "not-git" };
    case "unavailable":
      return unread(row.failure.message);
    case "failed":
      return unread(row.message);
    case "unreadable":
      return unread(`bb's git plugin answered "${row.answered}" in a shape this plugin can't read`);
    default:
      return row satisfies never;
  }
}

const unread = (reason: string): GitStatus => ({ kind: "unread", reason });

/** The checkout a read shows: its branch, commit and changed files, or why it names no commit. */
export function checkoutReadOf(status: GitStatus): CheckoutRead {
  switch (status.kind) {
    case "read":
      return status.headSha === null ? { kind: "unread", reason: "it named no commit checked out" } : { kind: "read", branch: status.branch, checkout: checkoutOf(status.headSha, status.changedFiles, status.changedFileCount) };
    case "not-git":
      return { kind: "unread", reason: "the environment is not a git repository" };
    case "unread":
      return status;
    default:
      return status satisfies never;
  }
}
