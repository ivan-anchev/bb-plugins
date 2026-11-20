// The upgrade of the regional managers 0.3.0 created, whose hook held a placeholder in each new
// thread's queue until the user typed the goal. This release has no hook, so each is decided by its
// thread's user messages, run or queued, never by its status (a placeholder sent anyway ran a turn):
// - a real message from the user: it keeps its thread and role, a missing GOAL.md is that first
//   message, and a placeholder still queued leaves the queue;
// - the placeholder only: it becomes not started, named as its thread is titled; its queue is
//   emptied (archiving would leave it) and its thread archived. Its goal is sent from its page;
// - no thread: it becomes not started.
// It looks at each one 0.3.0 flagged, and at each started one with no GOAL.md, as a placeholder-only
// one whose flag was cleared is.
import { randomUUID } from "node:crypto";
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { NAME_MAX } from "../../model/profile.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store/store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type QueuedRow = Pick<Awaited<ReturnType<Threads["queuedMessages"]["list"]>>[number], "id" | "initiator" | "senderThreadId" | "originPluginId" | "content">;

/** The parts of bb the upgrade uses, down to the fields it reads. */
type HeldBb = {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  sdk: {
    threads: {
      get(args: { threadId: string }): Promise<{ title: string | null }>;
      archive(args: Pick<Parameters<Threads["archive"]>[0], "threadId">): Promise<unknown>;
      events: { list(args: { threadId: string; types: ["client/turn/requested"]; order: "asc" }): Promise<readonly { data: unknown }[]> };
      queuedMessages: { list(args: { threadId: string }): Promise<readonly QueuedRow[]>; delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown> };
    };
  };
};

type Deps = { store: Pick<Store, "upgradeCandidates" | "goalGiven" | "unhold">; memory: MemoryRoot; onChange(): void };

/** What 0.3.0 spawned every regional manager with, exactly: the upgrade recognises it by this text alone. */
export const PLACEHOLDER = "Type this regional manager's goal below to start it.";
/** The name of one whose thread has no title, or that never had a thread. */
const UNTITLED = "Regional manager";
const GOAL_FILE = memoryFileSchema.parse("GOAL.md");

/**
 * The upgrade, run as the plugin loads and, after a pass that failed, from the tick. One pass at a
 * time: a call while one runs answers with it, and a call after a whole pass does nothing.
 */
export function upgradeFrom030(bb: HeldBb, { store, memory, onChange }: Deps): () => Promise<void> {
  let due = true;
  let running: Promise<void> | null = null;
  const failed = (what: string) => (error: unknown) => {
    due = true;
    bb.log.warn(`Could not ${what}; the next tick tries again: ${error instanceof Error ? error.message : String(error)}`);
  };

  async function upgrade({ id, ticket, threadId, flagged }: ReturnType<Store["upgradeCandidates"]>[number]): Promise<void> {
    if (threadId === null) return store.unhold(id, ticket, UNTITLED, randomUUID(), Date.now());
    const { threads } = bb.sdk;
    const [requested, queued] = await Promise.all([threads.events.list({ threadId, types: ["client/turn/requested"], order: "asc" }), threads.queuedMessages.list({ threadId })]);
    const waiting = queued.map((row) => ({ ...row, text: textOf(row.content) }));
    const messages = [...requested.flatMap(({ data }) => turnRequestSchema.safeParse(data).data ?? []).map((turn) => ({ ...turn, text: textOf(turn.input) })), ...waiting];
    const goal = messages.find((message) => fromTheUser(message) && message.text !== PLACEHOLDER && message.text.trim() !== "")?.text;
    // why the flag or the placeholder: a manager with neither, started by this release, is none of 0.3.0's.
    if (goal === undefined && !flagged && !messages.some(({ text }) => text === PLACEHOLDER)) return;
    for (const row of waiting) if (goal === undefined || row.text === PLACEHOLDER) await threads.queuedMessages.delete({ threadId, queuedMessageId: row.id });
    if (goal !== undefined) {
      // why over no file: a write expecting none leaves a GOAL.md that exists as it is.
      memory.of(id).write(GOAL_FILE, goal, null);
      return store.goalGiven(id);
    }
    const { title } = await threads.get({ threadId });
    await threads.archive({ threadId });
    store.unhold(id, ticket, title?.trim().slice(0, NAME_MAX).trim() || UNTITLED, randomUUID(), Date.now());
  }

  async function pass(): Promise<void> {
    for (const candidate of store.upgradeCandidates()) {
      if (!candidate.flagged && (candidate.threadId === null || memory.of(candidate.id).modifiedAt(GOAL_FILE) !== null)) continue;
      await upgrade(candidate).then(onChange, failed(`upgrade the regional manager ${candidate.id} 0.3.0 created`));
    }
  }

  return () => {
    if (running !== null || !due) return running ?? Promise.resolve();
    due = false;
    running = pass()
      .catch(failed("read the regional managers 0.3.0 created"))
      .finally(() => (running = null));
    return running;
  };
}

/** Whether a person typed the message: bb counts its author a user, and no thread or plugin sent it. */
const fromTheUser = ({ initiator, senderThreadId, originPluginId }: { initiator: string; senderThreadId: string | null; originPluginId?: string | null }): boolean =>
  initiator === "user" && senderThreadId === null && (originPluginId ?? null) === null;

/** A message's text as the manager reads it: its text parts, in order, without those only an agent sees. */
const textOf = (parts: readonly { type: string; text?: string; visibility?: string }[]): string =>
  parts.flatMap(({ type, text, visibility }) => (type === "text" && text !== undefined && visibility !== "agent-only" ? [text] : [])).join("\n\n");

// What the upgrade reads of a client/turn/requested event; the rest is bb's.
const turnRequestSchema = z.object({
  initiator: z.string(),
  senderThreadId: z.string().nullable(),
  originPluginId: z.string().optional(),
  input: z.array(z.object({ type: z.string(), text: z.string().optional(), visibility: z.string().optional() })),
});
