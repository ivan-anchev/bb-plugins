// A regional manager's goal is the user's first message in its thread. The New page creates the
// thread before there is one, and bb refuses a thread with no first message, so it is spawned with
// the plugin's placeholder, which this module's message.dispatch hook holds in bb's queue. The
// thread waits there, pending, with no environment, session or turn. The user's message then
// dispatches first, on the execution the placeholder's row carries; the hook writes it to GOAL.md
// as it lets it through, and holds every other message to the thread until then, so nothing but
// the goal starts its first turn. After that turn the placeholder is taken out of the queue.
//
// why the placeholder stays until then: its row carries the thread's execution (model, reasoning,
// permission mode, service tier), and a thread whose row was deleted before its first turn has none.
//
// The hook runs in bb's admission path for every message to every thread, under a server-wide lock,
// and fails the message if it throws: it reads only the plugin's own database, writes one small
// file, answers in milliseconds, catches everything and lets the message through on any error. It
// is idempotent: bb runs it again on every drain, restart and retry.
import type { MessageDispatchHookContext, MessageDispatchHookDecision, PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CoordinatorId } from "../../model/role.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store/store.ts";

/** What the plugin spawns a regional manager with: shown on its held row in the thread, and read by the manager if the user sends it anyway (roles.ts). */
export const PLACEHOLDER = "Type this regional manager's goal below to start it.";

/** Why the row waits, as bb shows it under "Held by Regional Manager". */
const HOLD_REASON = "Waiting for your goal";

type DispatchContext = Pick<MessageDispatchHookContext, "initiator" | "senderThreadId" | "origin" | "experimental_submission"> & {
  thread: Pick<MessageDispatchHookContext["thread"], "id">;
  input: Pick<MessageDispatchHookContext["input"], "blocks">;
  queuedMessages: readonly QueuedRow[];
};
type QueuedRow = Pick<MessageDispatchHookContext["queuedMessages"][number], "id" | "origin" | "originPluginId" | "content">;
/** A part of a message, as both bb's prompt input and its events carry it, down to what the plugin reads. */
type Part = { type: string; text?: string; visibility?: string };

/** The parts of bb the goal uses, as narrow as the code reads them. */
type GoalBb = {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  experimental_hooks: { on(hook: "message.dispatch", handler: (ctx: DispatchContext) => MessageDispatchHookDecision): void };
  events: { on(event: "thread.idle", handler: (payload: { thread: { id: string } }) => Promise<void>): void };
  sdk: {
    threads: {
      queuedMessages: {
        list(args: { threadId: string }): Promise<QueuedRow[]>;
        delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown>;
      };
      events: { list(args: { threadId: string; types: ["client/turn/requested"]; order: "asc" }): Promise<readonly { data: unknown }[]> };
    };
  };
};

type Deps = {
  store: Pick<Store, "roleOfThread" | "coordinator" | "awaitsGoal" | "goalGiven">;
  memory: MemoryRoot;
  /** Runs once the regional manager has its goal: its board stops saying it waits for one. */
  onChange(id: CoordinatorId): void;
};

export type Goals = ReturnType<typeof watchGoals>;

const PROCEED: MessageDispatchHookDecision = { action: "proceed" };
const HOLD: MessageDispatchHookDecision = { action: "wait", reason: HOLD_REASON };

export function watchGoals(bb: GoalBb, { store, memory, onChange }: Deps) {
  const warn = (what: string) => (error: unknown) => bb.log.warn(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  const isPlaceholder = (row: QueuedRow): boolean => row.origin === "plugin" && row.originPluginId === bb.pluginId && textOf(row.content) === PLACEHOLDER;

  function managerOf(threadId: string): CoordinatorId | null {
    const role = store.roleOfThread(threadId);
    return role?.kind === "coordinator" ? role.coordinatorId : null;
  }

  /** GOAL.md is the goal, unless it was written already, and the regional manager waits for it no more. */
  function take(id: CoordinatorId, goal: string): void {
    memory.of(id).seedGoal(goal);
    store.goalGiven(id);
    onChange(id);
  }

  /** Takes the placeholder out of the thread's queue. why not in the hook: bb holds its lock while the hook runs, and the delete goes through bb. */
  async function dropPlaceholder(threadId: string): Promise<void> {
    const queue = bb.sdk.threads.queuedMessages;
    const held = (await queue.list({ threadId })).filter(isPlaceholder);
    await Promise.all(held.map(({ id }) => queue.delete({ threadId, queuedMessageId: id }).catch(warn(`Could not take the placeholder ${id} out of ${threadId}'s queue`))));
  }

  function decide(ctx: DispatchContext): MessageDispatchHookDecision {
    // why the submission: the spawn's own attempt runs before bb answers the spawn, so before the thread is known to be a regional manager's.
    const placeholder = ctx.experimental_submission?.pluginId === bb.pluginId || (ctx.queuedMessages.length > 0 && ctx.queuedMessages.every(isPlaceholder));
    const id = managerOf(ctx.thread.id);
    const awaiting = id !== null && store.awaitsGoal(id);
    if (placeholder) {
      // why here too: bb tries the queue again as the first turn ends, and the hook then sees it.
      if (id !== null && !awaiting) setImmediate(() => void dropPlaceholder(ctx.thread.id).catch(warn(`Could not read ${ctx.thread.id}'s queue to take its placeholder out`)));
      return HOLD;
    }
    if (id === null || !awaiting) return PROCEED;
    // why hold the rest: a doorbell or another thread's message must not start the first turn in the goal's place.
    if (!fromTheUser(ctx)) return HOLD;
    take(id, textOf(ctx.input.blocks));
    return PROCEED;
  }

  bb.experimental_hooks.on("message.dispatch", (ctx) => {
    try {
      return decide(ctx);
    } catch (error) {
      warn(`Could not decide on a message to ${ctx.thread.id}, so it goes through`)(error);
      return PROCEED;
    }
  });

  bb.events.on("thread.idle", async ({ thread }) => {
    const id = managerOf(thread.id);
    if (id === null || store.awaitsGoal(id)) return;
    await dropPlaceholder(thread.id).catch(warn(`Could not read ${thread.id}'s queue to take its placeholder out`));
  });

  return {
    /**
     * Takes the regional manager's goal from its thread's first message from the user, if it still
     * waits for one: what the hook does, for a message the hook didn't see, as when the plugin was
     * reloading as it dispatched. A failed read is logged, and GOAL.md stays missing until the next.
     */
    async recover(id: CoordinatorId): Promise<void> {
      const coordinator = store.coordinator(id);
      if (coordinator === null || !store.awaitsGoal(id)) return;
      let requested: readonly { data: unknown }[];
      try {
        requested = await bb.sdk.threads.events.list({ threadId: coordinator.threadId, types: ["client/turn/requested"], order: "asc" });
      } catch (error) {
        warn(`Could not read ${coordinator.threadId}'s first messages for its goal`)(error);
        return;
      }
      const goal = requested.flatMap(({ data }) => {
        const turn = turnRequestSchema.safeParse(data);
        return turn.success && fromTheUser(turn.data) && textOf(turn.data.input) !== PLACEHOLDER ? [textOf(turn.data.input)] : [];
      })[0];
      if (goal !== undefined) take(id, goal);
    },
  };
}

/**
 * Whether a person typed the message: bb counts its author a user, no thread sent it, and no
 * plugin did. why not the placeholder: the user's Send now on it skips the hook.
 */
const fromTheUser = ({ initiator, senderThreadId, origin }: { initiator: string; senderThreadId: string | null; origin?: string | null }): boolean =>
  initiator === "user" && senderThreadId === null && origin !== "plugin";

/** A message's text as the manager reads it: its text parts, in order, without those only an agent sees. */
const textOf = (parts: readonly Part[]): string => parts.flatMap(({ type, text, visibility }) => (type === "text" && text !== undefined && visibility !== "agent-only" ? [text] : [])).join("\n\n");

// What the plugin reads of a client/turn/requested event; the rest is bb's.
const turnRequestSchema = z.object({
  initiator: z.string(),
  senderThreadId: z.string().nullable(),
  input: z.array(z.object({ type: z.string(), text: z.string().optional(), visibility: z.string().optional() })),
});
