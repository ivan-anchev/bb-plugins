// The upgrade of a regional manager 0.3.0 created and left waiting for its goal: its thread is
// pending, its only message the placeholder 0.3.0's message.dispatch hook held in bb's queue. This
// release has no hook, so the plugin makes it a regional manager not started yet, named as its thread
// is titled, and archives that thread: the user starts it from its page, with its goal, as any other.
// why not release the hold: bb would send the placeholder as its first message, which no rule
// explains any more. why archive first: until the manager is made not started, its thread is still
// its own, and an archived one sends nothing.
//
// Idempotent: each run skips what is done, and a step that fails is tried again by the next run.
import { randomUUID } from "node:crypto";
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { NAME_MAX } from "../../model/profile.ts";
import type { Store } from "../store/store.ts";

type Threads = BbPluginApi["sdk"]["threads"];

/** The parts of bb the upgrade uses, down to the fields it reads. */
type HeldBb = {
  log: Pick<PluginLogger, "warn">;
  sdk: {
    threads: {
      get(args: { threadId: string }): Promise<{ title: string | null; archivedAt: number | null }>;
      archive(args: Pick<Parameters<Threads["archive"]>[0], "threadId">): Promise<unknown>;
    };
  };
};

/** A name for a thread bb lists with no title: the profile needs one. */
const UNTITLED = "Regional manager";

/** Runs the upgrade over every regional manager still waiting for its goal; `onChange` after each one it upgraded, whose list entry moved. */
export function releaseHeldManagers(bb: HeldBb, store: Pick<Store, "heldManagers" | "unhold">, onChange: () => void): () => Promise<void> {
  return async () => {
    for (const { id, threadId } of store.heldManagers()) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        if (thread.archivedAt === null) await bb.sdk.threads.archive({ threadId });
        store.unhold(id, nameOf(thread.title), randomUUID(), Date.now());
        onChange();
      } catch (error) {
        bb.log.warn(`Could not make ${id}, which 0.3.0 left waiting for its goal in ${threadId}, a regional manager not started yet; the next tick tries again: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}

const nameOf = (title: string | null): string => title?.trim().slice(0, NAME_MAX).trim() || UNTITLED;
