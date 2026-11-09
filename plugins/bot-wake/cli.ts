import { cliCommand, defineCli, PluginCliError } from "@get-bb/plugin-sdk";
import { post, type Deliver } from "./delivery.ts";
import { drain } from "./drain.ts";
import type { FailureEntry, FailureLog } from "./failure-log.ts";
import { parseTarget, type Target } from "./routes.ts";
import type { TargetSecrets } from "./target-secrets.ts";
import { TEST_BODY } from "./wake-body.ts";

interface CliDeps {
  failures: FailureLog;
  deliver: Deliver;
  secrets: TargetSecrets;
  /** Aborts when the plugin instance unloads; used when the caller sends no signal of its own. */
  signal: AbortSignal;
}

const json = { type: "boolean", description: "Emit machine-readable JSON" } as const;

/** `bb bot-wake failures | drain | test <target>`. Prints targets and statuses, never a URL or key. */
export function botWakeCli({ failures, deliver, secrets, signal }: CliDeps) {
  return defineCli({
    name: "bot-wake",
    summary: "List, drain, and test Bot Wake webhook deliveries",
    commands: {
      failures: cliCommand({
        summary: "List events that could not be delivered, oldest first",
        options: {
          limit: { type: "integer", min: 1, max: 1000, default: 50, description: "Show at most this many" },
          json,
        },
        run({ options }) {
          const entries = failures.list();
          const shown = entries.slice(0, options.limit);
          if (options.json) return reply(JSON.stringify({ total: entries.length, failures: shown.map(toJson) }));
          return reply(formatFailures(shown, entries.length));
        },
      }),
      drain: cliCommand({
        summary: "Retry every logged event once; delivered ones leave the log",
        options: { json },
        async run({ options }, ctx) {
          const counts = await drain(failures, deliver, ctx.signal ?? signal);
          if (options.json) return reply(JSON.stringify(counts));
          return reply(`Delivered ${counts.delivered}, kept ${counts.kept}.`);
        },
      }),
      test: cliCommand({
        summary: "POST a harmless test event to a target and print the HTTP status",
        positionals: [{ name: "target", description: "Target name from the routes setting", required: true }],
        options: { json },
        async run({ positionals, options }, ctx) {
          const target = routedTarget(positionals.target, secrets.targets);
          const lookup = await secrets.endpoint(target);
          if (!lookup.ok) throw missingSecrets(target, lookup.missing);
          const result = await post(lookup.endpoint, TEST_BODY, ctx.signal ?? signal);
          const text = options.json ? JSON.stringify(result) : result.ok ? `HTTP ${result.status}` : `Failed: ${result.reason}`;
          return { exitCode: result.ok ? 0 : 1, stdout: `${text}\n` };
        },
      }),
    },
  });
}

function reply(text: string) {
  return { exitCode: 0, stdout: `${text}\n` };
}

function routedTarget(name: string, routed: readonly Target[]): Target {
  const target = parseTarget(name);
  if (target === null) {
    throw new PluginCliError(`"${name}" is not a target name: use letters, digits and _ only.`, {
      code: "invalid_target",
    });
  }
  if (!routed.includes(target)) {
    throw new PluginCliError(`No route sends to ${target}.`, {
      code: "unknown_target",
      hint: `Routed targets: ${routed.join(", ") || "none"}. Add ${target} to the routes setting first.`,
    });
  }
  return target;
}

function missingSecrets(target: Target, missing: readonly string[]): PluginCliError {
  return new PluginCliError(`${target} is missing ${missing.join(" and ")}.`, {
    code: "missing_secret",
    hint: "Set target secrets in Settings → Installed plugins → Bot Wake.",
  });
}

function toJson(entry: FailureEntry) {
  return { id: entry.id, time: new Date(entry.at).toISOString(), target: entry.target, reason: entry.reason, body: entry.body };
}

function formatFailures(shown: FailureEntry[], total: number): string {
  if (total === 0) return "No undelivered events.";
  const lines = shown.map((entry) =>
    [new Date(entry.at).toISOString(), entry.target, entry.body.event, entry.body.thread, entry.body.title, entry.reason].join("  "),
  );
  if (total > shown.length) lines.push(`… and ${total - shown.length} more (--limit).`);
  return lines.join("\n");
}
