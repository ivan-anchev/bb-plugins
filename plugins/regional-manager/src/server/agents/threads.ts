// How the plugin reads its threads from bb: by id, in pages, and a thread's latest turn. The board,
// the agents, the verify step and the PR watch all read through here, so "listed" and "current"
// have one meaning.
import { handoffIsCurrent, type Handoff } from "../../model/handoff.ts";

type ListArgs = { threadIds: string[]; includeHidden: true; limit: number };

/** The part of bb that lists threads by id, with the fields its caller reads. */
export type ListBb<Thread> = { sdk: { threads: { list(args: ListArgs): Promise<Thread[]> } } };

/** The part of bb a turn read uses: the thread's newest `turn/started` event. */
export type TurnsBb = {
  sdk: { threads: { events: { list(args: { threadId: string; types: ["turn/started"]; order: "desc"; limit: string }): Promise<{ seq: number }[]> } } };
};

// bb lists at most 200 threads by id per call.
const IDS_PER_LIST = 200;

type ListableThread = { id: string; archivedAt: number | null; deletedAt: number | null };

/**
 * The threads among `threadIds` that are neither archived nor deleted, hidden ones included. why by
 * id, not by parent: an agent someone moved under another thread is still its regional manager's.
 * why filter here: bb lists archived threads by id too.
 */
export async function listedThreads<Thread extends ListableThread>(bb: ListBb<Thread>, threadIds: string[]): Promise<Map<string, Thread>> {
  const threads = await threadsById(bb, threadIds);
  return new Map([...threads].filter(([, thread]) => isLive(thread)));
}

/** Whether bb still runs the thread: neither archived nor deleted. */
export const isLive = (thread: ListableThread): boolean => thread.archivedAt === null && thread.deletedAt === null;

/** The threads among `threadIds` that bb lists, archived and hidden ones included. */
export async function threadsById<Thread extends { id: string }>(bb: ListBb<Thread>, threadIds: string[]): Promise<Map<string, Thread>> {
  const threads = new Map<string, Thread>();
  for (let start = 0; start < threadIds.length; start += IDS_PER_LIST) {
    const threadIdsOfPage = threadIds.slice(start, start + IDS_PER_LIST);
    for (const thread of await bb.sdk.threads.list({ threadIds: threadIdsOfPage, includeHidden: true, limit: IDS_PER_LIST })) threads.set(thread.id, thread);
  }
  return threads;
}

/** The sequence of the thread's latest `turn/started` event; null when bb lists none. */
export async function latestTurnSeq(bb: TurnsBb, threadId: string): Promise<number | null> {
  const [latest] = await bb.sdk.threads.events.list({ threadId, types: ["turn/started"], order: "desc", limit: "1" });
  return latest?.seq ?? null;
}

/** The handoff if its thread has started no turn since, else null. Reads bb only when there is a handoff to judge. */
export async function ifCurrent<Handed extends { handoff: Pick<Handoff, "turnSeq"> }>(bb: TurnsBb, threadId: string, handed: Handed | null): Promise<Handed | null> {
  if (handed === null) return null;
  return handoffIsCurrent(handed.handoff, await latestTurnSeq(bb, threadId)) ? handed : null;
}

/** The part of bb stopping a turn uses: the stop, and the thread's status read after it. */
export type StopBb = ListBb<ListableThread & { status: string }> & { sdk: { threads: { stop(args: { threadId: string }): Promise<unknown> } } };

/**
 * Stops the thread's turn; null once bb no longer runs it, else the status bb still reports, as
 * when its stop is unconfirmed. Rejects as bb's stop does. why read again: bb's stop can leave the
 * thread stopping, and a turn is over only once its thread no longer runs.
 */
export async function stoppedTurn(bb: StopBb, threadId: string): Promise<string | null> {
  await bb.sdk.threads.stop({ threadId });
  const thread = (await threadsById(bb, [threadId])).get(threadId);
  return thread !== undefined && isLive(thread) && thread.status !== "idle" && thread.status !== "error" ? thread.status : null;
}
