// One thing at a time per issue. Everything that has an effect in bb on an issue's environment (a
// start or handover, agent_stop and its archive, a message or a verifier's findings sent to its
// agent, a verifier started or nudged) runs as one turn of its issue, from its decision until bb
// confirmed or refused its effects, and reads its facts and decides once it holds the turn. The
// database's transactions protect its rows; turns protect the awaits around them, where two
// operations deciding on the same facts would otherwise both act. Writes with no effect in bb (a
// handoff, a verdict, the tick ending an agent bb archived) need no turn.
//
// why in memory: the plugin's server is one process, so a queue per issue in it is enough. A crash
// or reload mid-turn drops the queue with whatever was awaiting bb: at worst an agent inserted with
// no thread, which the board flags Needs you, or a check still queued, which the tick starts again.
//
// why a lease: a call bb never answers would hold its issue forever. A turn lasts at most LEASE_MS;
// then the next waiting operation starts, and the late one's `check` throws, so it does nothing more.
// What bounds a waiter is the lease of each turn ahead of it. Only the one bb call in flight when a
// lease ran out can still land.
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** An operation's hold on its issue. */
export type Turn = {
  /** Throws once the turn's lease ran out and its issue moved on. Call it right before each effect that follows an await. */
  check(): void;
};

export type IssueTurns = ReturnType<typeof issueTurns>;

/** Long enough for bb to wake a suspended sandbox and spawn into it. */
const LEASE_MS = 2 * 60_000;

/** `leaseMs`: how long a turn holds its issue at most; tests shorten it. */
export function issueTurns(leaseMs = LEASE_MS) {
  // The latest turn asked for on each issue, resolved once it is over.
  const tails = new Map<string, Promise<void>>();

  return {
    /** Runs `operation` once every earlier turn of the issue is over, as the issue's only turn. */
    async run<T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: (turn: Turn) => Promise<T>): Promise<T> {
      const key = `${coordinatorId}/${issueId}`;
      const before = tails.get(key) ?? Promise.resolve();
      let end = (): void => {};
      const over = new Promise<void>((resolve) => (end = resolve));
      const tail = before.then(() => over);
      tails.set(key, tail);
      await before;
      let lost = false;
      const lease = setTimeout(() => {
        lost = true;
        end();
      }, leaseMs);
      // why unref: a turn bb never answers must not keep the process alive.
      lease.unref();
      try {
        return await operation({
          check() {
            if (lost) throw new Error(`bb took over ${leaseMs / 1000} seconds to answer, so ${issueId} went on to what waited behind this, and nothing more was done here.`);
          },
        });
      } finally {
        clearTimeout(lease);
        end();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}
