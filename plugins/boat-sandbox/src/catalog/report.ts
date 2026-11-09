// `bb boat templates`: every template a thread can start from, each with the exact --machine-inputs.
import { describeLaunch, resolveLaunch, type LaunchChoices, type MachineInputs } from "../launch.ts";
import { formatTable } from "../table.ts";

const HEADER = ["TEMPLATE", "STATUS", "SIZE", "SAVED", "--machine-inputs", "NOTES"] as const;

export function formatChoices(choices: LaunchChoices): string {
  const { templates, defaults } = choices;
  const table = formatTable(HEADER, [
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
  return [table, ...defaultLines(choices), "Save a template from any boat sandbox with: boat snapshot <sandbox-id> <name>", ""].join("\n");
}

function defaultLines(choices: LaunchChoices): string[] {
  const resolution = resolveLaunch({}, choices);
  if (!resolution.ok) return [`Default launch (Settings → boat Sandbox) is refused: ${resolution.message}`];
  return [
    `Default launch (Settings → boat Sandbox): ${describeLaunch(resolution.launch)}.`,
    "  bb thread spawn --project <project-id> --environment-provider boat-sandbox \\",
    `    --machine-inputs '${inputsOf(resolution.launch)}' --prompt "…"`,
  ];
}

const inputsOf = (inputs: MachineInputs): string => JSON.stringify(inputs);
