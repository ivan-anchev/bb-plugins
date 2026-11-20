// The upgrade of the regional managers 0.3.0 created and left waiting for their goal. 0.3.0 spawned
// each with a placeholder that its message.dispatch hook held in bb's queue, and let only the user's
// goal through. This release has no hook, so the plugin, once as it loads:
// - keeps a manager whose thread ran a turn, which had its goal, as it is, its thread and role kept;
// - makes one whose thread is still pending a manager not started yet, named as its thread is titled:
//   it takes the placeholder out of the queue (archiving would leave it there) and archives the
//   thread, which never holds the role again. The user sends its goal from its page;
// - makes one whose spawn never bound a thread a manager not started yet.
// why not release the hold: bb would send the placeholder as its first message, which no rule
// explains any more. A manager whose upgrade fails stays as it is until the plugin loads again.
import { randomUUID } from "node:crypto";
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { NAME_MAX } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

type Threads = BbPluginApi["sdk"]["threads"];

/** The parts of bb the upgrade uses, down to the fields it reads. */
type HeldBb = {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  sdk: {
    threads: {
      get(args: { threadId: string }): Promise<{ title: string | null; status: string }>;
      archive(args: Pick<Parameters<Threads["archive"]>[0], "threadId">): Promise<unknown>;
      queuedMessages: {
        list(args: { threadId: string }): Promise<readonly { id: string; originPluginId: string | null }[]>;
        delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown>;
      };
    };
  };
};

/** A name for a manager whose thread bb lists with no title, or that never had one: the profile needs one. */
const UNTITLED = "Regional manager";

/** Upgrades every regional manager 0.3.0 left waiting for its goal; `onChange` after each, whose list entry moved. A manager that fails is logged, and the rest go on. */
export async function releaseHeldManagers(bb: HeldBb, store: Pick<Store, "heldManagers" | "goalGiven" | "unhold">, onChange: () => void): Promise<void> {
  async function release(id: CoordinatorId, threadId: string | null): Promise<void> {
    if (threadId === null) return store.unhold(id, UNTITLED, randomUUID(), Date.now());
    const thread = await bb.sdk.threads.get({ threadId });
    // why pending: a held thread never ran a turn, and the hold let nothing but the user's goal start one.
    if (thread.status !== "pending") return store.goalGiven(id);
    // why every row of the plugin's: it sent a waiting manager nothing but its placeholder.
    const queue = bb.sdk.threads.queuedMessages;
    for (const row of await queue.list({ threadId })) if (row.originPluginId === bb.pluginId) await queue.delete({ threadId, queuedMessageId: row.id });
    await bb.sdk.threads.archive({ threadId });
    store.unhold(id, nameOf(thread.title), randomUUID(), Date.now());
  }

  for (const { id, threadId } of store.heldManagers()) {
    try {
      await release(id, threadId);
      onChange();
    } catch (error) {
      bb.log.warn(`Could not upgrade ${id}, which 0.3.0 left waiting for its goal; it stays as it is until the plugin loads again: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const nameOf = (title: string | null): string => title?.trim().slice(0, NAME_MAX).trim() || UNTITLED;
