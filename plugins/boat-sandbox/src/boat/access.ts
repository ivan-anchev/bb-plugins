// Whether the configured key can run sandboxes: the settings first, then boat's view of the
// key's account and wallet.
import { PASTE_KEY_STEP, resolveSettings, type BoatSettings } from "../settings.ts";
import { problem, type Problem } from "../problem.ts";
import { BoatApiError, createBoatClient, type BoatClient } from "./client.ts";
import type { Account, Limits } from "./wire.ts";

/** What boat says about the configured key. */
export interface BoatFacts {
  account: Account;
  limits: Limits;
}

export type Configuration =
  | { status: "available"; facts: BoatFacts }
  | { status: "setup-required"; facts: null; problems: readonly [Problem] }
  | { status: "unavailable"; facts: BoatFacts | null; problems: readonly [Problem, ...Problem[]] };

export interface BoatAccess {
  /** Reads the settings and, with a key, boat's /me and /limits. Never throws. */
  configuration(signal?: AbortSignal): Promise<Configuration>;
}

export function createBoatAccess(settings: Pick<BoatSettings, "get">): BoatAccess {
  return {
    async configuration(signal) {
      const resolved = resolveSettings(await settings.get());
      if (!resolved.ok) return { status: "setup-required", facts: null, problems: [resolved.problem] };

      let facts: BoatFacts;
      try {
        facts = await readFacts(createBoatClient(resolved.apiKey), signal);
      } catch (error) {
        return { status: "unavailable", facts: null, problems: [unreadable(error)] };
      }

      const [first, ...rest] = refusals(facts);
      if (first === undefined) return { status: "available", facts };
      return { status: "unavailable", facts, problems: [first, ...rest] };
    },
  };
}

async function readFacts(client: BoatClient, signal: AbortSignal | undefined): Promise<BoatFacts> {
  const [account, limits] = await Promise.all([client.me(signal), client.limits(signal)]);
  return { account, limits };
}

/** Accounts boat Sandbox refuses to run on. */
function refusals({ account, limits }: BoatFacts): Problem[] {
  const problems: Problem[] = [];
  if (account.zeroDataRetention)
    problems.push(problem(
      "Zero data retention is on for this boat account, so every stop deletes the sandbox and bb could never resume it.",
      "Paste a key from a boat account without zero data retention into Settings → boat Sandbox → API key",
    ));
  if (limits.wallet.kind === "organization")
    problems.push(problem(
      `This key bills the organization wallet ${limits.wallet.teamId}; boat Sandbox bills personal wallets only.`,
      "Run `boat org switch personal`",
    ));
  return problems;
}

function unreadable(error: unknown): Problem {
  if (error instanceof BoatApiError && (error.status === 401 || error.status === 403))
    return problem(`boat rejected the API key (${error.status} ${error.code}).`, PASTE_KEY_STEP);
  return problem(
    `Could not read the boat account: ${error instanceof Error ? error.message : String(error)}`,
    "Check the network connection",
  );
}
