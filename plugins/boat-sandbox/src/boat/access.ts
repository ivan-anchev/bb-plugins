// Whether the configured key can run sandboxes: the settings first, then boat's view of the
// key's account and wallet.
import { PASTE_KEY_STEP, resolveSettings, type BoatSettings, type ResolvedSettings } from "../settings.ts";
import { describeProblems, messageOf, problem, type Problem } from "../problem.ts";
import { BoatApiError, createBoatClient, type BoatClient } from "./client.ts";
import type { Account, Limits } from "./wire.ts";

/** What boat says about the configured key. */
export interface BoatFacts {
  account: Account;
  limits: Limits;
}

/**
 * `refused` is boat's definite answer (a rejected key, an account boat Sandbox cannot run on), so
 * nothing launches until the settings change. `read-failed` is no answer (the network, a timeout,
 * boat failing), so the next read may work.
 */
export type Configuration =
  | { status: "available"; facts: BoatFacts; client: BoatClient; settings: Extract<ResolvedSettings, { ok: true }> }
  | { status: "setup-required"; facts: null; problems: readonly [Problem] }
  | { status: "refused"; facts: BoatFacts | null; problems: readonly [Problem, ...Problem[]] }
  | { status: "read-failed"; facts: null; problems: readonly [Problem] };

export interface BoatAccess {
  /** Reads the settings and, with a key, boat's /me and /limits. Never throws. */
  configuration(signal?: AbortSignal): Promise<Configuration>;
  /** The available configuration, for work on boat; throws the problems' text otherwise. */
  session(signal?: AbortSignal): Promise<BoatSession>;
}

export type BoatSession = Extract<Configuration, { status: "available" }>;

export function createBoatAccess(settings: Pick<BoatSettings, "get">): BoatAccess {
  async function configuration(signal?: AbortSignal): Promise<Configuration> {
    const resolved = resolveSettings(await settings.get());
    if (!resolved.ok) return { status: "setup-required", facts: null, problems: [resolved.problem] };

    const client = createBoatClient(resolved.apiKey);
    let facts: BoatFacts;
    try {
      facts = await readFacts(client, signal);
    } catch (error) {
      if (error instanceof BoatApiError && (error.status === 401 || error.status === 403))
        return { status: "refused", facts: null, problems: [problem(`boat rejected the API key (${error.status} ${error.code}).`, PASTE_KEY_STEP)] };
      return { status: "read-failed", facts: null, problems: [unreadable(error)] };
    }

    const [first, ...rest] = refusals(facts);
    if (first === undefined) return { status: "available", facts, client, settings: resolved };
    return { status: "refused", facts, problems: [first, ...rest] };
  }

  return {
    configuration,
    async session(signal) {
      const current = await configuration(signal);
      if (current.status !== "available") throw new Error(describeProblems(current.problems));
      return current;
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

const unreadable = (error: unknown): Problem =>
  problem(`Could not read the boat account: ${messageOf(error)}`, "Check the network connection");
