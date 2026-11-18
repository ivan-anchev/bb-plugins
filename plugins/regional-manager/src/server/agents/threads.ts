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

/** The part of bb stopping a turn uses: the threads' statuses, and the stop. */
export type StopBb = ListBb<StoppableThread> & { sdk: { threads: { stop(args: { threadId: string }): Promise<unknown> } } };

type StoppableThread = ListableThread & { status: string };

/** What a stop did: the threads bb reported running that it stopped, and every one bb hasn't confirmed stopped, with why (see stopEach). */
type Stopped = { stopped: string[]; unstopped: { threadId: string; why: string }[] };

/** Stops every thread among `threadIds` that bb reports running, never archiving one (see stopEach). */
export async function stopRunning(bb: StopBb, threadIds: readonly string[]): Promise<Stopped> {
  return stopEach(bb, [...(await threadsById(bb, [...threadIds])).values()].filter(isRunning));
}

/**
 * Stops every live thread among `threadIds`, whatever status bb reports, never archiving one (see
 * stopEach). why idle ones too: a turn can end with a background command still running, and when it
 * finishes the provider starts a new turn in the thread by itself; bb's stop ends those commands,
 * on an idle thread too, and nothing wakes the thread after (seen live on bb 0.49, QA Q22).
 */
export async function stopThreads(bb: StopBb, threadIds: readonly string[]): Promise<Stopped> {
  return stopEach(bb, [...(await listedThreads(bb, [...threadIds])).values()]);
}

/**
 * Stops each thread, never archiving one: a thread lives in its environment, and archiving a
 * sandbox's last live thread destroys it (SH5). why read again after each stop: bb's stop can leave
 * the thread stopping, and a turn is over only once its thread no longer runs. Returns the ones bb
 * reported running that it stopped, and every one bb hasn't confirmed stopped, with the status bb
 * still reports, or bb's error when the stop or the read after it failed. why not "wasn't stopped"
 * then: a stop whose answer is lost may have stopped the thread.
 */
async function stopEach(bb: StopBb, threads: readonly StoppableThread[]): Promise<Stopped> {
  const stops = await Promise.all(
    threads.map(async ({ id: threadId }) => {
      try {
        await bb.sdk.threads.stop({ threadId });
        const thread = (await threadsById(bb, [threadId])).get(threadId);
        return thread !== undefined && isRunning(thread) ? { threadId, why: `is still ${thread.status}` } : null;
      } catch (error) {
        return { threadId, why: `couldn't be confirmed stopped: bb answered ${error instanceof Error ? error.message : String(error)}` };
      }
    }),
  );
  return { stopped: threads.filter((thread, i) => stops[i] === null && isRunning(thread)).map(({ id }) => id), unstopped: stops.filter((stop) => stop !== null) };
}

/** Whether bb runs a turn in the thread: live, and neither idle nor failed. */
const isRunning = (thread: StoppableThread): boolean => isLive(thread) && thread.status !== "idle" && thread.status !== "error";
