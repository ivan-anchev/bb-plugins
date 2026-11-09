// bb boat …: thin commands that read, then print.
import { cliCommand, defineCli } from "@get-bb/plugin-sdk";
import { readLaunchChoices } from "./catalog/read.ts";
import { formatChoices } from "./catalog/report.ts";
import { configurationLines, readStatus, type StatusDeps } from "./status.ts";
import { observe, type ObserveDeps } from "./sweep/observe.ts";
import { planSweep } from "./sweep/plan.ts";
import { formatRows, sandboxRows } from "./sweep/report.ts";

/** Bounds a command run without a caller's signal. */
const PATIENCE_MS = 60_000;

/** `machines` is what the sweep looks at, so `bb boat sandboxes` shows exactly what it would do. */
export function boatCli(deps: StatusDeps, machines: ObserveDeps) {
  const { boat } = deps;
  return defineCli({
    name: "boat",
    summary: "boat.dev sandboxes for bb threads",
    commands: {
      status: cliCommand({
        summary: "Check the boat API key, account, wallet and start budget, what a thread sandbox starts from by default, and the GitHub login it uses",
        run: async (_input, ctx) => {
          const { usable, lines } = await readStatus(deps, ctx.signal);
          return { exitCode: usable ? 0 : 1, stdout: `${lines.join("\n")}\n` };
        },
      }),
      templates: cliCommand({
        summary: "List the boat saved snapshots a thread sandbox can start from, with the --machine-inputs for each",
        options: { json: { type: "boolean", description: "Print the templates and defaults as one JSON object" } },
        run: async ({ options }, ctx) => {
          const signal = ctx.signal ?? AbortSignal.timeout(PATIENCE_MS);
          const configuration = await boat.configuration(signal);
          if (configuration.status !== "available") return { exitCode: 1, stdout: `${configurationLines(configuration).join("\n")}\n` };
          const choices = await readLaunchChoices(configuration, signal);
          return { exitCode: 0, stdout: options.json ? `${JSON.stringify(choices, null, 2)}\n` : formatChoices(choices) };
        },
      }),
      sandboxes: cliCommand({
        summary: "List this bb server's boat sandboxes, their machines, and what the next sweep would do",
        options: { json: { type: "boolean", description: "Print the rows as a JSON array" } },
        run: async ({ options }, ctx) => {
          const signal = ctx.signal ?? AbortSignal.timeout(PATIENCE_MS);
          const configuration = await boat.configuration(signal);
          if (configuration.status !== "available") return { exitCode: 1, stdout: `${configurationLines(configuration).join("\n")}\n` };
          const input = await observe(machines, configuration.client, signal);
          const rows = sandboxRows(input, planSweep(input, { now: Date.now(), idleMs: configuration.settings.idleMs }));
          return { exitCode: 0, stdout: options.json ? `${JSON.stringify(rows, null, 2)}\n` : formatRows(rows) };
        },
      }),
    },
  });
}
