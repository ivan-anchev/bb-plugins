// `bb boat status`: what boat says about the configured key, and what a thread sandbox gets by default.
import type { BoatAccess, BoatFacts, BoatSession, Configuration } from "./boat/access.ts";
import type { Limits, Wallet } from "./boat/wire.ts";
import { readLaunchChoices } from "./catalog/read.ts";
import { describeLaunch, resolveLaunch } from "./launch.ts";
import { messageOf } from "./problem.ts";
import { DEFAULT_TEMPLATE_STEP } from "./settings.ts";

/** Usable when boat Sandbox can run; the exit code depends on that alone. */
export async function readStatus(boat: BoatAccess, signal?: AbortSignal): Promise<{ usable: boolean; lines: string[] }> {
  const configuration = await boat.configuration(signal);
  if (configuration.status !== "available") return { usable: false, lines: configurationLines(configuration) };
  return { usable: true, lines: [...configurationLines(configuration), ...(await defaultLaunchLines(configuration, signal))] };
}

/** One line per fact, then each problem with the command that fixes it. */
export function configurationLines(configuration: Configuration): string[] {
  const facts = configuration.facts === null ? [] : factLines(configuration.facts);
  const problems = configuration.status === "available"
    ? []
    : configuration.problems.flatMap((problem) => [problem.message, `Fix: ${problem.fix}`]);
  return [...facts, ...problems];
}

/** What a thread that names no template or size gets, checked against boat's saved snapshots. */
async function defaultLaunchLines(session: BoatSession, signal: AbortSignal | undefined): Promise<string[]> {
  try {
    const resolution = resolveLaunch({}, await readLaunchChoices(session, signal));
    if (!resolution.ok) return [`Default launch: refused: ${resolution.message}`, `Fix: ${DEFAULT_TEMPLATE_STEP}.`];
    return [`Default launch: ${describeLaunch(resolution.launch)}`];
  } catch (error) {
    // The key works (status exits 0); only the snapshot list could not be read.
    return [`Default launch: unknown (${messageOf(error)})`];
  }
}

function factLines({ account, limits }: BoatFacts): string[] {
  return [
    "API key: accepted by boat",
    `Account: ${account.id} (${account.login})`,
    `Wallet: ${describeWallet(limits.wallet)}`,
    `Zero data retention: ${account.zeroDataRetention ? "on" : "off"}`,
    `Starts: ${describeStarts(limits)}`,
  ];
}

function describeWallet(wallet: Wallet): string {
  switch (wallet.kind) {
    case "personal":
      return "personal";
    case "organization":
      return `organization ${wallet.teamId}`;
  }
}

function describeStarts({ starts, startsBlockedBy }: Limits): string {
  const budget = starts.unlimited
    ? "unlimited"
    : `${starts.minute.used}/${starts.minute.limit} in the last minute, ` +
      `${starts.hour.used}/${starts.hour.limit} in the last hour, ` +
      `${starts.day.used}/${starts.day.limit} in the last day`;
  return startsBlockedBy === null ? budget : `${budget}; blocked: ${startsBlockedBy}`;
}
