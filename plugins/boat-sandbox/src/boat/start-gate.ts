// boat's start budget. boat refuses an over-limit start with `429 rate_limited` and never queues it.
import { setTimeout as sleep } from "node:timers/promises";
import { BoatApiError } from "./client.ts";

/** The per-minute window clears within this; the hour and day windows are not worth holding a create for. */
const SHORT_WAIT_MS = 60_000;

export class StartLimitError extends Error {
  override readonly name = "StartLimitError";
  readonly nextStartAt: number;

  constructor(nextStartAt: number) {
    super(`boat's start limit is reached; the next sandbox can start at ${new Date(nextStartAt).toISOString()}.`);
    this.nextStartAt = nextStartAt;
  }
}

export interface StartGate {
  /**
   * Runs one start (anything boat counts as a start). After a 429 it waits out a short window once
   * and runs `start` again with `retry` true; a longer window, or a 429 on the retry, fails with
   * `StartLimitError`, and every later start respects that window. A 429 created nothing, so the retry
   * may use a fresh Idempotency-Key, which keeps it from depending on whether boat binds a key to a
   * refused request.
   */
  start<T>(start: (retry: boolean) => Promise<T>, signal: AbortSignal): Promise<T>;
  /**
   * Runs a start boat should not count (taking back a kept machine) at once, past any window. If boat
   * counts it after all and answers 429, that window is recorded and the start is retried as `start` does.
   */
  startUncounted<T>(start: (retry: boolean) => Promise<T>, signal: AbortSignal): Promise<T>;
}

export function createStartGate(): StartGate {
  // In memory only: after a restart boat answers 429 once more, which costs nothing.
  let blockedUntil = 0;

  async function waitForWindow(signal: AbortSignal): Promise<void> {
    const waitMs = blockedUntil - Date.now();
    if (waitMs <= 0) return;
    if (waitMs > SHORT_WAIT_MS) throw new StartLimitError(blockedUntil);
    await sleep(waitMs, undefined, { signal });
  }

  /** Runs `start` once; a start-limit 429 moves the window and fails as `StartLimitError`. */
  async function attempt<T>(start: (retry: boolean) => Promise<T>, retry: boolean): Promise<T> {
    try {
      return await start(retry);
    } catch (error) {
      if (!isStartLimit(error)) throw error;
      // Concurrent starts may each see a 429; the latest window wins.
      blockedUntil = Math.max(blockedUntil, Date.now() + (error.retryAfterMs ?? SHORT_WAIT_MS));
      throw new StartLimitError(blockedUntil);
    }
  }

  /** One attempt, then one retry once a short window clears. */
  async function attemptAndRetry<T>(start: (retry: boolean) => Promise<T>, signal: AbortSignal): Promise<T> {
    try {
      return await attempt(start, false);
    } catch (error) {
      if (!(error instanceof StartLimitError)) throw error;
      await waitForWindow(signal);
      return attempt(start, true);
    }
  }

  return {
    async start(start, signal) {
      await waitForWindow(signal);
      return attemptAndRetry(start, signal);
    },
    startUncounted: attemptAndRetry,
  };
}

// Only `rate_limited` clears by waiting: `limit_reached` (sandboxes at once), the trial compute cap
// and 402s do not, so they surface with boat's own message.
const isStartLimit = (error: unknown): error is BoatApiError =>
  error instanceof BoatApiError && error.status === 429 && error.code === "rate_limited";
