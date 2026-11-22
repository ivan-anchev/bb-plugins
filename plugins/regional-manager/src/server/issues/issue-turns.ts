import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** What an operation that didn't get its issue's turn returns: it did nothing, and can be asked again. */
export type Busy = { busy: string };

export type IssueTurns = ReturnType<typeof issueTurns>;

const WAIT_MS = 30_000;

/** `disposal`: aborts as the plugin's instance is disposed (lifetime.ts). `waitMs`: how long `run` waits for the turn; tests shorten it. */
export function issueTurns(disposal: AbortSignal, waitMs = WAIT_MS) {
  const tails = new Map<string, Promise<void>>();
  const keyOf = (coordinatorId: CoordinatorId, issueId: IssueId) => `${coordinatorId}/${issueId}`;
  const busy = (issueId: IssueId): Busy => ({ busy: `an earlier operation on ${issueId} hasn't finished yet, so nothing changed` });

  async function take<T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: () => Promise<T>, ready: (before: Promise<void>) => Promise<boolean>): Promise<T | Busy> {
    const key = keyOf(coordinatorId, issueId);
    const before = tails.get(key) ?? Promise.resolve();
    let end = (): void => {};
    const over = new Promise<void>((resolve) => (end = resolve));
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
    run: <T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: () => Promise<T>): Promise<T | Busy> => take(coordinatorId, issueId, operation, (before) => settlesWithin(before, waitMs)),

    runIfFree: <T>(coordinatorId: CoordinatorId, issueId: IssueId, operation: () => Promise<T>): Promise<T | Busy> =>
      tails.has(keyOf(coordinatorId, issueId)) ? Promise.resolve(busy(issueId)) : take(coordinatorId, issueId, operation, async () => true),
  };
}

async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}
