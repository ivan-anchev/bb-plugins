import { z } from "zod";
import type { Target } from "./routes.ts";
import type { Endpoint, TargetSecrets } from "./target-secrets.ts";
import type { WakeBody } from "./wake-body.ts";

/**
 * Why a delivery failed, as a category only. Fetch's own error text is never
 * kept: undici messages can embed the host. `cancelled` means grok-wake itself
 * stopped the request (the plugin unloaded, or the CLI caller went away).
 */
export const failureReasonSchema = z.union([
  z.templateLiteral(["http ", z.number()]),
  z.enum(["timeout", "network", "missing-secret", "cancelled"]),
]);
export type FailureReason = z.infer<typeof failureReasonSchema>;

export type DeliveryResult = { ok: true; status: number } | { ok: false; reason: FailureReason };

const TIMEOUT_MS = 8000;

/** Delivers a body to a target, giving up when `signal` aborts. */
export type Deliver = (target: Target, body: WakeBody, signal: AbortSignal) => Promise<DeliveryResult>;

/**
 * Delivers to a target by name: a target missing its URL or key fails as
 * `missing-secret`, unless `signal` aborted during the lookup.
 */
export function deliverWith(secrets: Pick<TargetSecrets, "endpoint">): Deliver {
  return async (target, body, signal) => {
    const lookup = await secrets.endpoint(target);
    if (signal.aborted) return { ok: false, reason: "cancelled" };
    return lookup.ok ? post(lookup.endpoint, body, signal) : { ok: false, reason: "missing-secret" };
  };
}

/**
 * POSTs the body to the endpoint once. A redirect is answered as its own
 * status, never followed: following would POST a second time and carry the
 * key to wherever the redirect points.
 */
export async function post(
  endpoint: Endpoint,
  body: WakeBody,
  signal: AbortSignal,
  timeoutMs = TIMEOUT_MS,
): Promise<DeliveryResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.key}`,
        "X-Automation-Key": endpoint.key,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.any([signal, timeout]),
    });
    await response.body?.cancel();
    return response.ok ? { ok: true, status: response.status } : { ok: false, reason: `http ${response.status}` };
  } catch {
    return { ok: false, reason: signal.aborted ? "cancelled" : timeout.aborted ? "timeout" : "network" };
  }
}
