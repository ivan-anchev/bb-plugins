// What a thread sandbox launches with: the machine inputs a thread may pass (`--machine-inputs`), the
// defaults from settings, the templates and environments boat has, and the one rule that turns the
// three into a launch. A preset is one of boat's sandbox `type` values; a template is a boat saved
// snapshot; an environment decides the sign-ins, GitHub token and secrets the sandbox gets.
import { z } from "zod";
import type { SandboxEnvironment, SavedSnapshot } from "./boat/wire.ts";
import { shellQuote } from "./shell.ts";

export const PRESETS = ["small", "default", "large", "xlarge"] as const;

export type Preset = (typeof PRESETS)[number];

/** boat's saved-snapshot name (OAS `SavedSnapshot.name`). */
export const snapshotName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

/** boat's environment names are free text; whether boat has one is resolveLaunch's call. */
export const environmentName = z.string().min(1);

/**
 * Persisted on the launch and readable by every plugin, so it names things and holds no secret.
 * An omitted key takes the setting's default; `template: null` asks for boat's stock image even when a
 * Default template is set.
 */
export const machineInputs = z
  .object({
    template: snapshotName.nullable().optional(),
    environment: environmentName.optional(),
    preset: z.enum(PRESETS).optional(),
  })
  .strict();

export type MachineInputs = z.output<typeof machineInputs>;

/** Settings → boat Sandbox, parsed once. A null template is boat's stock image; a null environment is boat's default. */
export interface LaunchDefaults {
  template: string | null;
  environment: string | null;
  preset: Preset;
}

/**
 * What a thread can launch from now: boat's saved snapshots and environments, and the defaults.
 * `bb boat templates --json` prints it.
 */
export interface LaunchChoices {
  templates: readonly SavedSnapshot[];
  environments: readonly SandboxEnvironment[];
  defaults: LaunchDefaults;
}

/** Every field named, so it is also a complete MachineInputs. */
export interface Launch {
  /** null: boat's stock image. */
  template: string | null;
  environment: string;
  preset: Preset;
}

/** The setting a refused name came from; null when the thread named it. */
export type DefaultSetting = "defaultTemplate" | "defaultEnvironment";

export type LaunchResolution =
  | { ok: true; launch: Launch; environment: SandboxEnvironment }
  | { ok: false; message: string; setting: DefaultSetting | null };

const SETTING_LABELS: Record<DefaultSetting, string> = {
  defaultTemplate: "Default template",
  defaultEnvironment: "Default environment",
};

/**
 * The one rule for a launch: validate, create, `bb boat status` and `bb boat templates` all call it.
 * Each key is the input, else its setting; the environment then falls back to boat's default.
 * Whether the plan allows a preset is boat's call: its 403 names the plan a preset needs.
 */
export function resolveLaunch(inputs: MachineInputs, { templates, environments, defaults }: LaunchChoices): LaunchResolution {
  const template = inputs.template === undefined ? defaults.template : inputs.template;
  const templateSetting = inputs.template === undefined ? "defaultTemplate" : null;
  const templateRefusal = template === null ? null : refuseTemplate(template, templates, templateSetting);
  if (templateRefusal !== null) return templateRefusal;

  const environmentName = inputs.environment ?? defaults.environment;
  const environmentSetting = inputs.environment === undefined && environmentName !== null ? "defaultEnvironment" : null;
  const environment = environmentName === null
    ? environments.find((candidate) => candidate.isBoatDefault)
    : environments.find((candidate) => candidate.name === environmentName);
  if (environment === undefined)
    return refuse(`boat has no environment "${environmentName}"${suffix(environmentSetting)}. Run \`bb boat templates\` to list them.`, environmentSetting);

  return { ok: true, launch: { template, environment: environment.name, preset: inputs.preset ?? defaults.preset }, environment };
}

function refuseTemplate(template: string, templates: readonly SavedSnapshot[], setting: DefaultSetting | null): LaunchResolution | null {
  const found = templates.find((candidate) => candidate.name === template);
  const from = suffix(setting);
  if (found === undefined)
    return refuse(`No saved snapshot "${template}" on this boat account${from}. Run \`bb boat templates\` to list them.`, setting);
  switch (found.status) {
    case "ready":
      return null;
    case "saving":
      return refuse(`Template "${template}" is still saving on boat${from}. Start the thread once \`bb boat templates\` shows it ready.`, setting);
    case "failed":
      return refuse(`boat could not save template "${template}"${from}: ${found.error}. Save it again with \`boat snapshot <sandbox-id> ${shellQuote(template)}\`.`, setting);
    default:
      return found.status satisfies never;
  }
}

const suffix = (setting: DefaultSetting | null): string => (setting === null ? "" : ` (Settings → boat Sandbox → ${SETTING_LABELS[setting]})`);

const refuse = (message: string, setting: DefaultSetting | null): LaunchResolution => ({ ok: false, message, setting });

/** `a small boat sandbox from template node-tools in environment base`, for the create step, status and `bb boat templates`. */
export function describeLaunch({ template, environment, preset }: Launch): string {
  const sandbox = `${preset === "xlarge" ? "an" : "a"} ${preset} boat sandbox`;
  const from = template === null ? "from boat's stock image" : `from template ${template}`;
  return `${sandbox} ${from} in environment ${environment}`;
}
