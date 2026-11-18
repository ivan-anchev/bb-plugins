// The coordinating thread's own working tree, read through bb's git plugin each time one of its
// turns ends, and when it keeps what the user asked it to change (see own-tree.ts). bb has no
// read-only mode, and a plugin can't take a provider's tools away, so this is how an edit the thread
// made shows.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CoordinatorId } from "../../model/role.ts";
import { threadsById, type ListBb } from "../agents/threads.ts";
import { gitStatusOf, type GitStatusBb } from "../git-status.ts";
import type { Store } from "../store/store.ts";
import { failed, forManager, type ToolsBb } from "../tools/tool-kit.ts";
import type { Inbox } from "./inbox.ts";

const KEEP_EDITS = "keep_edits";

/** What configure offers a regional manager of these tools. */
export const OWN_TREE_TOOLS = [KEEP_EDITS];

/** A thread as bb's thread.idle names it, down to the fields the watch reads. */
type ThreadRef = { id: string; originPluginId: string | null; environmentId: string | null };

/** The parts of bb the watch uses. */
type OwnTreeBb = GitStatusBb &
  ToolsBb &
  ListBb<{ id: string; environmentId: string | null }> & {
    pluginId: string;
    log: Pick<PluginLogger, "warn">;
    onDispose(hook: () => void): void;
    events: { on(event: "thread.idle", handler: (payload: { thread: ThreadRef }) => Promise<void>): void };
  };

type Deps = { bb: OwnTreeBb; store: Pick<Store, "roleOfThread" | "keepOwnTree">; inbox: Pick<Inbox, "ownTreeRead"> };

export function watchOwnTree({ bb, store, inbox }: Deps): void {
  // why: a read can still be out when bb reloads or disables the plugin, and its answer must write nothing.
  const disposal = new AbortController();
  bb.onDispose(() => disposal.abort());
  // why numbered: two reads of one Coordinator can overlap, and an older answer must not overwrite a newer one.
  let reads = 0;
  const latestApplied = new Map<CoordinatorId, number>();

  /** The environment's changed files, for the caller to apply at once; null when they can't be read, or a newer read of the Coordinator's was applied first. */
  async function readTree(id: CoordinatorId, environmentId: string): Promise<string[] | null> {
    const read = ++reads;
    const changed = await changedFiles(environmentId);
    if (changed === null || disposal.signal.aborted || read < (latestApplied.get(id) ?? 0)) return null;
    latestApplied.set(id, read);
    return changed;
  }

  bb.events.on("thread.idle", async ({ thread }) => {
    // why skip before SQLite: most threads are another plugin's or the user's.
    if (thread.originPluginId !== bb.pluginId || thread.environmentId === null) return;
    const role = store.roleOfThread(thread.id);
    if (role?.kind !== "coordinator") return;
    const changed = await readTree(role.coordinatorId, thread.environmentId);
    if (changed !== null) inbox.ownTreeRead(role.coordinatorId, changed);
  });

  bb.agents.registerTool({
    name: KEEP_EDITS,
    description:
      "Keep the files you changed in your working tree as they are now. Call it only when the user's own message told you to change them yourself, once you made exactly that change. Without it, the plugin takes files you changed for a draft when your turn ends, and has you hand it to an agent.",
    presentation: { label: { pending: "Keeping your edits", completed: "Kept your edits" }, icon: { glyph: "Check" } },
    parameters: z.object({}),
    execute: forManager(store, KEEP_EDITS, async (id, _input, { threadId }) => {
      const environmentId = (await threadsById(bb, [threadId])).get(threadId)?.environmentId ?? null;
      if (environmentId === null) return failed(`${KEEP_EDITS} is refused: bb names no environment for your thread, so there is nothing to keep.`);
      const kept = await readTree(id, environmentId);
      if (kept === null) return failed(`${KEEP_EDITS} is refused: bb's git plugin can't read your working tree now. Call it again in a minute.`);
      store.keepOwnTree(id, kept);
      return kept.length === 0 ? "Your working tree has no changed files, so there is nothing to keep." : `Kept ${kept.map((file) => `\`${file}\``).join(", ")} as the user asked: the plugin won't take ${kept.length === 1 ? "it" : "them"} for a draft.`;
    }),
  });

  /** The files changed in the environment's working tree; null when bb's git plugin can't say, which records nothing. */
  async function changedFiles(environmentId: string): Promise<string[] | null> {
    const status = await gitStatusOf(bb, environmentId, disposal.signal);
    // why silent: the plugin was disposed and cancelled the read, so nobody is left to be told.
    if (disposal.signal.aborted) return null;
    switch (status.kind) {
      case "read":
        return status.changedFiles.map(({ path }) => path);
      case "not-git":
        // why silent: a coordinating thread outside git has no working tree to change.
        return null;
      case "unread":
        // why recorded nothing: the next turn's end reads again.
        return unread(environmentId, status.reason);
      default:
        return status satisfies never;
    }
  }

  function unread(environmentId: string, why: string): null {
    bb.log.warn(`Could not read the working tree of the regional manager's environment ${environmentId}, so an edit there isn't reported: ${why}`);
    return null;
  }
}
