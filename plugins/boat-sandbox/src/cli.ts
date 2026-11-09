// bb boat …: thin commands that read, then print.
import { cliCommand, defineCli } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatFacts, Configuration } from "./boat/access.ts";
import type { Limits, Wallet } from "./boat/wire.ts";
import { observe, type ObserveDeps } from "./sweep/observe.ts";
import { planSweep } from "./sweep/plan.ts";
import { formatRows, sandboxRows } from "./sweep/report.ts";

/** Bounds a command run without a caller's signal. */
const PATIENCE_MS = 60_000;

/** `machines` is what the sweep looks at, so `bb boat sandboxes` shows exactly what it would do. */
export function boatCli(boat: BoatAccess, machines: ObserveDeps) {
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
      sandboxes: cliCommand({
        summary: "List this bb server's boat sandboxes, their machines, and what the next sweep would do",
        options: { json: { type: "boolean", description: "Print the rows as a JSON array" } },
        run: async ({ options }, ctx) => {
          const signal = ctx.signal ?? AbortSignal.timeout(PATIENCE_MS);
          const configuration = await boat.configuration(signal);
          if (configuration.status !== "available") return { exitCode: 1, stdout: `${statusLines(configuration).join("\n")}\n` };
          const input = await observe(machines, configuration.client, signal);
          const rows = sandboxRows(input, planSweep(input, { now: Date.now(), idleMs: configuration.settings.idleMs }));
          return { exitCode: 0, stdout: options.json ? `${JSON.stringify(rows, null, 2)}\n` : formatRows(rows) };
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
