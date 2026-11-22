// Watching a running hidden thread, a verifier or a reviewer, that nobody but the plugin watches:
// what it asks a person is declined at once (verifier-asks.ts), and the backstop ends one that
// stalled: a turn held open by something nobody answers, or a provider that stopped talking.
import { declineAsks, type AsksBb, type Checker } from "./verifier-asks.ts";

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
async function stalled(bb: ActivityBb, threadId: string, since: number, now: number): Promise<boolean> {
  const [latest] = await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "1" });
  return now - (latest?.createdAt ?? since) >= STALL_MS;
}

/** What watching a running hidden thread found: it runs on, after the plugin declined what it asked a person (none: it asked nothing); or its work ends, and why. */
export type Watched = { kind: "running"; declined: string[] } | { kind: "ended"; reason: string };

/**
 * Watches a running `who`'s thread once: declines whatever it asks a person, and ends it when bb
 * refuses a decline, or when it showed no activity for STALL_MS, naming what was declined before
 * (`declinedBefore`). why end it then: left running, it holds the agent's environment, still on
 * its ask or its stalled command (seen live). The caller records the end and stops the thread.
 */
export async function watchHidden(
  bb: AsksBb & ActivityBb,
  thread: { id: string; hasPendingInteraction: boolean; createdAt: number },
  who: Checker,
  declinedBefore: readonly string[],
  now: number,
): Promise<Watched> {
  if (thread.hasPendingInteraction) {
    const declined = await declineAsks(bb, thread.id, who);
    const refused = declined.find(({ refused }) => refused !== null);
    if (refused !== undefined) return { kind: "ended", reason: `its ${who} asked a person "${refused.asked}", and bb refused the plugin's decline: ${refused.refused}` };
    return { kind: "running", declined: declined.map(({ asked }) => asked) };
  }
  if (!(await stalled(bb, thread.id, thread.createdAt, now))) return { kind: "running", declined: [] };
  const asked = declinedBefore.length === 0 ? "" : `, after the plugin declined what it asked a person (${declinedBefore.map((ask) => `"${ask}"`).join("; ")})`;
  return { kind: "ended", reason: `its ${who} showed no activity for ${STALL_MS / 60_000} minutes${asked}` };
}
