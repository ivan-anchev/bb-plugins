// A read that may fail, reported as `unknown (<reason>)` and never thrown.
import { BoatApiError } from "./boat/client.ts";
import { messageOf } from "./problem.ts";

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * `scope` names the boat scope the read needs, for a key that lacks it (a `ci` key lacks
 * account.admin); `elsewhere` says where the user can still see the fact, for example
 * "`boat ai profiles` shows it".
 */
export async function settle<T>(read: Promise<T>, scope?: string, elsewhere?: string): Promise<Read<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    const reason = reasonOf(error, scope);
    return { ok: false, reason: elsewhere === undefined ? reason : `${reason}; ${elsewhere}` };
  }
}

/** boat's typed 403s for scoped keys (docs: API keys → Scopes → Errors); any other failure in boat's or bb's words. */
function reasonOf(error: unknown, scope: string | undefined): string {
  if (!(error instanceof BoatApiError) || error.status !== 403) return messageOf(error);
  if (error.code === "api_key_action_forbidden" && scope !== undefined) return `the API key lacks boat's ${scope} scope`;
  if (error.code === "api_key_expired") return "the API key has expired";
  return error.message;
}
