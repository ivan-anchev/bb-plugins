// The coordinating thread's own working tree, read through bb's git plugin each time one of its
// turns ends (see own-tree.ts). bb has no read-only mode, and a plugin can't take a provider's
// tools away, so this is how an edit the thread made shows.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store.ts";
import type { Inbox } from "./inbox.ts";

/**
 * The part of a `bb--git` `status` row the watch reads (`bb plugin rpc inspect bb--git status`
 * prints the whole). why the last: a newer bb--git can answer an outcome this plugin doesn't know,
 * or a known one in a shape it can't read, and either must record nothing rather than fail.
 */
const statusRowSchema = z.union([
  z.object({ outcome: z.literal("available"), workspace: z.object({ workingTree: z.object({ fileCount: z.number().int().min(0) }) }) }),
  z.object({ outcome: z.literal("not_applicable") }),
  z.object({ outcome: z.literal("unavailable"), failure: z.object({ message: z.string() }) }),
  z.object({ outcome: z.literal("failed"), message: z.string() }),
  z.object({ outcome: z.string() }).transform(({ outcome }) => ({ outcome: "unreadable" as const, answered: outcome })),
]);

type StatusRow = z.infer<typeof statusRowSchema>;

/** A thread as bb's thread.idle names it, down to the fields the watch reads. */
type ThreadRef = { id: string; originPluginId: string | null; environmentId: string | null };

/** The parts of bb the watch uses. */
type OwnTreeBb = {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  onDispose(hook: () => void): void;
  events: { on(event: "thread.idle", handler: (payload: { thread: ThreadRef }) => Promise<void>): void };
  sdk: { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: { keys: string[] }; outputSchema: z.ZodType<T>; signal: AbortSignal }): Promise<T> } };
};

type Deps = { bb: OwnTreeBb; store: Pick<Store, "roleOfThread">; inbox: Pick<Inbox, "ownTreeRead"> };

export function watchOwnTree({ bb, store, inbox }: Deps): void {
  // why: a read can still be out when bb reloads or disables the plugin, and its answer must write nothing.
  const disposal = new AbortController();
  bb.onDispose(() => disposal.abort());
  // why numbered: two turns' reads of one Coordinator can overlap, and an older answer must not overwrite a newer one.
  let reads = 0;
  const latestApplied = new Map<CoordinatorId, number>();

  bb.events.on("thread.idle", async ({ thread }) => {
    // why skip before SQLite: most threads are another plugin's or the user's.
    if (thread.originPluginId !== bb.pluginId || thread.environmentId === null) return;
    const role = store.roleOfThread(thread.id);
    if (role?.kind !== "coordinator") return;
    const read = ++reads;
    const fileCount = await changedFileCount(thread.environmentId);
    if (fileCount === null || disposal.signal.aborted || read < (latestApplied.get(role.coordinatorId) ?? 0)) return;
    latestApplied.set(role.coordinatorId, read);
    inbox.ownTreeRead(role.coordinatorId, fileCount);
  });

  /** How many files changed in the environment's working tree; null when bb's git plugin can't say, which records nothing. */
  async function changedFileCount(environmentId: string): Promise<number | null> {
    let rows: Record<string, StatusRow>;
    try {
      rows = await bb.sdk.plugins.callRpc({
        pluginId: "bb--git",
        method: "status",
        input: { keys: [environmentId] },
        outputSchema: z.record(z.string(), statusRowSchema),
        signal: disposal.signal,
      });
    } catch (error) {
      // why silent: the plugin was disposed and cancelled the read, so nobody is left to be told.
      if (disposal.signal.aborted) return null;
      // why caught: the git plugin may be off, or its machine unreachable; the next turn's end reads again.
      return unread(environmentId, error instanceof Error ? error.message : String(error));
    }
    // why possibly undefined: bb's git plugin may leave a key out.
    const row: StatusRow | undefined = rows[environmentId];
    if (row === undefined) return unread(environmentId, "bb's git plugin returned no row for it");
    switch (row.outcome) {
      case "available":
        return row.workspace.workingTree.fileCount;
      case "not_applicable":
        // why silent: a coordinating thread outside git has no working tree to change.
        return null;
      case "unavailable":
        return unread(environmentId, row.failure.message);
      case "failed":
        return unread(environmentId, row.message);
      case "unreadable":
        return unread(environmentId, `bb's git plugin answered "${row.answered}" in a shape this plugin can't read`);
      default:
        return row satisfies never;
    }
  }

  function unread(environmentId: string, why: string): null {
    bb.log.warn(`Could not read the working tree of the coordinating thread's environment ${environmentId}, so an edit there isn't reported: ${why}`);
    return null;
  }
}
