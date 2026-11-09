// `bb boat templates`: every template and environment a thread can start from, each with the exact
// --machine-inputs, shell-quoted: environment names are free text.
import type { SandboxEnvironment } from "../boat/wire.ts";
import { describeLaunch, resolveLaunch, type LaunchChoices, type LaunchDefaults, type MachineInputs } from "../launch.ts";
import { shellQuote } from "../shell.ts";
import { formatTable } from "../table.ts";

const TEMPLATE_HEADER = ["TEMPLATE", "STATUS", "SIZE", "SAVED", "--machine-inputs", "NOTES"] as const;
const ENVIRONMENT_HEADER = ["ENVIRONMENT", "PASSES", "--machine-inputs", "NOTES"] as const;

export function formatChoices(choices: LaunchChoices): string {
  return [templateTable(choices), environmentTable(choices), ...defaultLines(choices), "Save a template from any boat sandbox with: boat snapshot <sandbox-id> <name>", ""].join("\n");
}

function templateTable({ templates, defaults }: LaunchChoices): string {
  return formatTable(TEMPLATE_HEADER, [
    ["boat stock image", "ready", "-", "-", inputsOf({ template: null }), defaults.template === null ? "default" : ""],
    ...templates.map((template) => [
      template.name,
      template.status,
      template.savedFrom ?? "-",
      // To the minute, in UTC: 2026-11-09T10:12Z.
      `${template.savedAt.slice(0, 16)}Z`,
      template.status === "ready" ? inputsOf({ template: template.name }) : "-",
      [template.name === defaults.template ? "default" : "", template.error ?? ""].filter(Boolean).join("; "),
    ]),
  ]);
}

function environmentTable({ environments, defaults }: LaunchChoices): string {
  return formatTable(
    ENVIRONMENT_HEADER,
    environments.map((environment) => [
      environment.name,
      describePasses(environment),
      inputsOf({ environment: environment.name }),
      [environment.isBoatDefault ? "boat's default" : "", isDefault(environment, defaults) ? "default" : ""].filter(Boolean).join("; "),
    ]),
  );
}

/** The environment a thread that names none starts in. */
const isDefault = (environment: SandboxEnvironment, defaults: LaunchDefaults): boolean =>
  defaults.environment === null ? environment.isBoatDefault : environment.name === defaults.environment;

/** What boat puts on a sandbox in this environment, as `boat env set` names it. */
function describePasses({ withholdsAll, proxiesAi, passes }: SandboxEnvironment): string {
  if (withholdsAll) return proxiesAi ? "AI proxy placeholders only (safe for third parties)" : "nothing (safe for third parties)";
  const passed = [passes.agents ? "agents" : "", passes.github ? "GitHub" : "", passes.secrets ? "secrets" : ""].filter(Boolean);
  return passed.length === 0 ? "nothing" : passed.join(", ");
}

function defaultLines(choices: LaunchChoices): string[] {
  const resolution = resolveLaunch({}, choices);
  if (!resolution.ok) return [`Default launch (Settings → boat Sandbox) is refused: ${resolution.message}`];
  return [
    `Default launch (Settings → boat Sandbox): ${describeLaunch(resolution.launch)}.`,
    "  bb thread spawn --project <project-id> --environment-provider boat-sandbox \\",
    `    --machine-inputs ${inputsOf(resolution.launch)} --prompt "…"`,
  ];
}

/** One shell word, ready to paste after `--machine-inputs`. */
const inputsOf = (inputs: MachineInputs): string => shellQuote(JSON.stringify(inputs));
