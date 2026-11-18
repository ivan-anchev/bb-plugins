// The coordinating thread's own checkout, read through bb's git plugin each time one of its turns
// ends (see own-tree.ts). bb has no read-only mode, and a plugin can't take a provider's tools away,
// so this is how an edit the thread made shows. It only reads: nothing here changes the checkout.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { OwnTree } from "../../model/inbox/own-tree.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { gitStatusOf, type GitStatusBb } from "../git-status.ts";
import type { Store } from "../store/store.ts";
import type { Inbox } from "./inbox.ts";

/** A thread as bb's thread.idle names it, down to the fields the watch reads. */
type ThreadRef = { id: string; originPluginId: string | null; environmentId: string | null };

/** The parts of bb the watch uses. */
type OwnTreeBb = GitStatusBb & {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  onDispose(hook: () => void): void;
  events: { on(event: "thread.idle", handler: (payload: { thread: ThreadRef }) => Promise<void>): void };
};

type Deps = { bb: OwnTreeBb; store: Pick<Store, "roleOfThread">; inbox: Pick<Inbox, "ownTreeRead"> };

export function watchOwnTree({ bb, store, inbox }: Deps): void {
  // why: a read can still be out when bb reloads or disables the plugin, and its answer must write nothing.
  const disposal = new AbortController();
  bb.onDispose(() => disposal.abort());
  // why numbered: two reads of one Coordinator can overlap, and an older answer must not overwrite a newer one.
  let reads = 0;
  const latestApplied = new Map<CoordinatorId, number>();

  bb.events.on("thread.idle", async ({ thread }) => {
    // why skip before SQLite: most threads are another plugin's or the user's.
    if (thread.originPluginId !== bb.pluginId || thread.environmentId === null) return;
    const role = store.roleOfThread(thread.id);
    if (role?.kind !== "coordinator") return;
    const read = ++reads;
    const tree = await treeOf(thread.environmentId);
    if (tree === null || disposal.signal.aborted || read < (latestApplied.get(role.coordinatorId) ?? 0)) return;
    latestApplied.set(role.coordinatorId, read);
    inbox.ownTreeRead(role.coordinatorId, tree);
  });

  /** The environment's working tree; null when bb's git plugin can't say, which records nothing. */
  async function treeOf(environmentId: string): Promise<OwnTree | null> {
    const status = await gitStatusOf(bb, environmentId, disposal.signal);
    // why silent: the plugin was disposed and cancelled the read, so nobody is left to be told.
    if (disposal.signal.aborted) return null;
    switch (status.kind) {
      case "read":
        return { files: status.changedFiles.map(({ path }) => path), fileCount: status.changedFileCount, defaultBranch: status.defaultBranch };
      case "not-git":
        // why silent: a coordinating thread outside git has no working tree to change.
        return null;
      case "unread":
        // why recorded nothing: the next turn's end reads again.
        bb.log.warn(`Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: ${status.reason}`);
        return null;
      default:
        return status satisfies never;
    }
  }
}
