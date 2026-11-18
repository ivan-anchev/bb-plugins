// One thing at a time per issue. Everything that changes an issue's facts or has an effect in bb on
// its threads (a start or handover, agent_stop, a message to its agent, a handoff, a verdict, a
// verifier started, nudged or given up on, findings sent back, an agent ended as its thread was
// archived or deleted) runs as one turn of its issue, and reads its facts once it holds the turn.
// The database's transactions protect its rows; turns protect the awaits around them, where two
// operations deciding on the same facts would otherwise both act.
//
// why a turn is held until its operation settles, however long bb takes: while a call to bb is out,
// its outcome is unknown, and whatever acted next would decide on a guess. What is bounded is the
// wait: a caller that waited WAIT_MS gets Busy, having done nothing, and the tick never waits.
//
// why a disposed instance admits nothing more: a new one runs the issues now (lifetime.ts).
//
// why in memory, and what ends a turn bb never answers: the plugin's server is one process, so a
// queue per issue in it is enough, and nothing in the plugin ends such a turn. A reload drops the
// queue with whatever was awaiting bb, and the new instance acts on what bb and the database say:
// an agent inserted whose spawn never answered has no thread, which the board flags Needs you until
// agent_stop ends it, or binds when bb makes its thread; a check still queued is started again by
// the tick; a thread the lost call started or woke is one of the issue's, so the next start on the
// issue, an agent's or a verifier's, finds it running in bb and stops it first.
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** What an operation that didn't get its issue's turn returns: it did nothing, and can be asked again. */
export type Busy = { busy: string };

export type IssueTurns = ReturnType<typeof issueTurns>;

/** How long a tool call waits for its issue's turn before it is refused. */
const WAIT_MS = 30_000;

/** `disposal`: aborts as the plugin's instance is disposed (lifetime.ts). `waitMs`: how long `run` waits for the turn; tests shorten it. */
export function issueTurns(disposal: AbortSignal, waitMs = WAIT_MS) {
  // The latest turn asked for on each issue, resolved once it and every turn before it are over.
  const tails = new Map<string, Promise<void>>();
  const keyOf = (coordinatorId: CoordinatorId, issueId: IssueId) => `${coordinatorId}/${issueId}`;
  const busy = (issueId: IssueId): Busy => ({ busy: `an earlier operation on ${issueId} hasn't finished yet, so nothing changed` });

  /** Queues for the issue's turn; runs `operation` once `ready` says the turns before are over, else returns Busy. */
  async function take<T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: () => Promise<T>, ready: (before: Promise<void>) => Promise<boolean>): Promise<T | Busy> {
    const key = keyOf(coordinatorId, issueId);
    const before = tails.get(key) ?? Promise.resolve();
    let end = (): void => {};
    const over = new Promise<void>((resolve) => (end = resolve));
    // why after `before`: a caller that gave up waiting must not let the turns behind it pass the one it waited for.
    const tail = before.then(() => over);
    tails.set(key, tail);
    const forget = () => tails.get(key) === tail && tails.delete(key);
    if (!(await ready(before))) {
      end();
      void tail.then(forget);
      return busy(issueId);
    }
    try {
      disposal.throwIfAborted();
      return await operation();
    } finally {
      end();
      forget();
    }
  }

  return {
    /** Runs `operation` as the issue's only turn once every earlier one is over; Busy, with nothing run, after waiting `waitMs`. */
    run: <T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: () => Promise<T>): Promise<T | Busy> => take(coordinatorId, issueId, operation, (before) => settlesWithin(before, waitMs)),

    /** For the tick, which never waits: runs `operation` as the issue's turn if no operation holds or waits for it; else Busy, and the next tick tries again. */
    runIfFree: <T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: () => Promise<T>): Promise<T | Busy> =>
      tails.has(keyOf(coordinatorId, issueId)) ? Promise.resolve(busy(issueId)) : take(coordinatorId, issueId, operation, async () => true),
  };
}

/** Whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}
