import type { Deliver } from "./delivery.ts";
import type { FailureLog } from "./failure-log.ts";

interface DrainCounts {
  delivered: number;
  kept: number;
}

/**
 * Retries every logged event once: delivered ones leave the log, the rest keep
 * their new reason. Stops once `signal` aborts or a delivery is cancelled,
 * leaving every entry not yet retried as it was.
 */
export async function drain(failures: FailureLog, deliver: Deliver, signal: AbortSignal): Promise<DrainCounts> {
  const counts: DrainCounts = { delivered: 0, kept: 0 };
  for (const entry of failures.list()) {
    if (signal.aborted) break;
    const result = await deliver(entry.target, entry.body, signal);
    if (result.ok) {
      failures.remove(entry.id);
      counts.delivered += 1;
    } else if (result.reason === "cancelled") {
      break;
    } else {
      failures.updateReason(entry.id, result.reason);
      counts.kept += 1;
    }
  }
  return counts;
}
