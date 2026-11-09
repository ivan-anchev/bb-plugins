// The only module that speaks HTTP to boat.dev.
import { wireError, wireLimits, wireMe, type Account, type Limits } from "./wire.ts";

const BASE_URL = "https://boat.dev/api/v1";

/** Every non-2xx response from boat, in one shape. */
export class BoatApiError extends Error {
  override readonly name = "BoatApiError";
  readonly status: number;
  readonly code: string;
  /** From `Retry-After`, which boat sends on every 429. */
  readonly retryAfterMs: number | null;

  constructor(status: number, code: string, message: string, retryAfterMs: number | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface BoatClient {
  me(signal?: AbortSignal): Promise<Account>;
  /** Start budget and wallet of the wallet a create would bill. */
  limits(signal?: AbortSignal): Promise<Limits>;
}

export function createBoatClient(apiKey: string): BoatClient {
  return {
    me: async (signal) => wireMe.parse(await request(apiKey, "/me", signal)),
    limits: async (signal) => wireLimits.parse(await request(apiKey, "/limits", signal)),
  };
}

/** The one fetch wrapper: bearer auth, JSON back, and every non-2xx thrown as a BoatApiError. */
async function request(apiKey: string, path: string, signal: AbortSignal | undefined): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw toApiError(response, text);
  return JSON.parse(text);
}

// A gateway in front of boat can answer with HTML, so the body may not be boat's envelope.
function toApiError(response: Response, text: string): BoatApiError {
  const envelope = wireError.safeParse(parseJson(text));
  const retryAfter = response.headers.get("retry-after");
  return new BoatApiError(
    response.status,
    envelope.success ? envelope.data.code : `http_${response.status}`,
    envelope.success ? envelope.data.message : `HTTP ${response.status} ${response.statusText}`,
    retryAfter === null ? null : Number(retryAfter) * 1000,
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
