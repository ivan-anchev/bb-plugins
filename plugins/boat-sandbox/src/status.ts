// `bb boat status`: what boat says about the configured key, then what a thread that names nothing
// gets: the default launch, the agent sign-ins its environment passes, and the GitHub login it uses.
// Every read after the key check is settled, so a refused one reads `unknown (<reason>)` and the
// command goes on.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatFacts, BoatSession, Configuration } from "./boat/access.ts";
import type { Limits, Wallet } from "./boat/wire.ts";
import { readLaunchChoices } from "./catalog/read.ts";
import { githubLines, githubSourceOf } from "./github.ts";
import { describeLaunch, resolveLaunch } from "./launch.ts";
import { DEFAULT_STEPS } from "./settings.ts";
import { settle } from "./settle.ts";
import { agentLines, proxyLine, SIGN_IN_ROWS } from "./sign-ins.ts";

export interface StatusDeps {
  boat: BoatAccess;
  /** bb's machine environment, for whether bb forwards its GitHub login. */
  machineEnvironment: BbPluginApi["sdk"]["system"]["machineEnvironment"];
}

/** Usable when boat Sandbox can run; the exit code depends on that alone. */
export async function readStatus(deps: StatusDeps, signal?: AbortSignal): Promise<{ usable: boolean; lines: string[] }> {
  const configuration = await deps.boat.configuration(signal);
  if (configuration.status !== "available") return { usable: false, lines: configurationLines(configuration) };
  return { usable: true, lines: [...configurationLines(configuration), ...(await defaultLaunchLines(deps, configuration, signal))] };
}

/** One line per fact, then each problem with the command that fixes it. */
export function configurationLines(configuration: Configuration): string[] {
  const facts = configuration.facts === null ? [] : factLines(configuration.facts);
  const problems = configuration.status === "available"
    ? []
    : configuration.problems.flatMap((problem) => [problem.message, `Fix: ${problem.fix}`]);
  return [...facts, ...problems];
}

/** What a thread that names nothing gets, checked against boat's saved snapshots and environments. */
async function defaultLaunchLines({ machineEnvironment }: StatusDeps, session: BoatSession, signal: AbortSignal | undefined): Promise<string[]> {
  const [choices, profiles, app, github] = await Promise.all([
    settle(readLaunchChoices(session, signal), "snapshot.read and environment.read"),
    settle(session.client.credentialProfiles(signal), "account.admin", "`boat ai profiles` shows it"),
    // No scope named: boat documents none for GET /repos, so a refusal reads in boat's words.
    settle(session.client.githubApp(signal)),
    settle(machineEnvironment()).then((read) => (read.ok ? githubSourceOf(read.value.builtInGit.status) : read)),
  ]);
  const { account } = session.facts;
  if (!choices.ok)
    return [
      `Default launch: unknown (${choices.reason})`,
      ...SIGN_IN_ROWS.map((row) => `${row}: unknown (${choices.reason})`),
      ...githubLines(github, { account, environment: choices, app }),
    ];

  const resolution = resolveLaunch({}, choices.value);
  if (!resolution.ok)
    return [
      `Default launch: refused: ${resolution.message}`,
      ...(resolution.setting === null ? [] : [`Fix: ${DEFAULT_STEPS[resolution.setting]}.`]),
      ...githubLines(github, { account, environment: { ok: false, reason: "the default launch is refused" }, app }),
    ];
  const { launch, environment } = resolution;
  return [
    `Default launch: ${describeLaunch(launch)}${environment.isBoatDefault ? " (boat's default environment)" : ""}`,
    ...agentLines(environment, account, profiles),
    proxyLine(environment, account, profiles),
    ...githubLines(github, { account, environment: { ok: true, value: environment }, app }),
  ];
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
