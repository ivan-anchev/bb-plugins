/**
 * How long a running verifier may show no activity before its check ends as could-not-run. why 30
 * minutes: across 34 verifiers that returned a verdict, the longest silence in bb's events was 5
 * minutes (a model reasoning after a long command), and every one returned within 14; a running
 * command streams its output as events, so only a command quiet for half an hour is cut short.
 */
export const STALL_MS = 30 * 60_000;

/** The part of bb the read uses: the thread's newest event of any kind. */
export type ActivityBb = {
  sdk: { threads: { events: { list(args: { threadId: string; order: "desc"; limit: string }): Promise<{ createdAt: number }[]> } } };
};

/** Whether the thread has shown no event for STALL_MS by `now`, counting from `since` while it has none. */
export async function stalled(bb: ActivityBb, threadId: string, since: number, now: number): Promise<boolean> {
  const [latest] = await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "1" });
  return now - (latest?.createdAt ?? since) >= STALL_MS;
}
