// bb boat …: thin commands that read, then print.
import { cliCommand, defineCli } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatFacts, Configuration } from "./boat/access.ts";
import type { Limits, Wallet } from "./boat/wire.ts";

export function boatCli(boat: BoatAccess) {
  return defineCli({
    name: "boat",
    summary: "boat.dev sandboxes for bb threads",
    commands: {
      status: cliCommand({
        summary: "Check the boat API key, account, wallet and start budget",
        run: async (_input, ctx) => {
          const configuration = await boat.configuration(ctx.signal);
          return {
            exitCode: configuration.status === "available" ? 0 : 1,
            stdout: `${statusLines(configuration).join("\n")}\n`,
          };
        },
      }),
    },
  });
}

/** One line per fact, then each problem with the command that fixes it. */
function statusLines(configuration: Configuration): string[] {
  const facts = configuration.facts === null ? [] : factLines(configuration.facts);
  const problems = configuration.status === "available"
    ? []
    : configuration.problems.flatMap((problem) => [problem.message, `Fix: ${problem.fix}`]);
  return [...facts, ...problems];
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
