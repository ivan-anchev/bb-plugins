// A boat read that may fail, reported as `unknown (<reason>)` and never thrown.
import { BoatApiError } from "./boat/client.ts";
import { messageOf } from "./problem.ts";

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * `scope` names the boat scope a 403 means (a `ci` key lacks account.admin); `elsewhere` says where
 * the user can still see the fact, for example "`boat ai profiles` shows it".
 */
export async function settle<T>(read: Promise<T>, scope: string, elsewhere?: string): Promise<Read<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    const reason = error instanceof BoatApiError && error.status === 403 ? `the API key lacks boat's ${scope} scope` : messageOf(error);
    return { ok: false, reason: elsewhere === undefined ? reason : `${reason}; ${elsewhere}` };
  }
}
