// What a thread sandbox launches with: the machine inputs a thread may pass (`--machine-inputs`), the
// defaults from settings, the templates boat has, and the one rule that turns the three into a launch.
// A preset is one of boat's sandbox `type` values; a template is a boat saved snapshot.
import { z } from "zod";
import type { SavedSnapshot } from "./boat/wire.ts";

export const PRESETS = ["small", "default", "large", "xlarge"] as const;

export type Preset = (typeof PRESETS)[number];

/** boat's saved-snapshot name (OAS `SavedSnapshot.name`). */
export const snapshotName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

/**
 * Persisted on the launch and readable by every plugin, so it names things and holds no secret.
 * An omitted key takes the setting's default; `template: null` asks for boat's stock image even when a
 * Default template is set.
 */
export const machineInputs = z
  .object({
    template: snapshotName.nullable().optional(),
    preset: z.enum(PRESETS).optional(),
  })
  .strict();

export type MachineInputs = z.output<typeof machineInputs>;

/** Settings → boat Sandbox, parsed once. A null template is boat's stock image. */
export interface LaunchDefaults {
  template: string | null;
  preset: Preset;
}

/** What a thread can launch from now: boat's saved snapshots, and the defaults. `bb boat templates --json` prints it. */
export interface LaunchChoices {
  templates: readonly SavedSnapshot[];
  defaults: LaunchDefaults;
}

/** Every field named, so it is also a complete MachineInputs. */
export interface Launch {
  /** null: boat's stock image. */
  template: string | null;
  preset: Preset;
}

export type LaunchResolution = { ok: true; launch: Launch } | { ok: false; message: string };

const FROM_SETTING = " (Settings → boat Sandbox → Default template)";

/**
 * The one rule for a launch: validate, create, `bb boat status` and `bb boat templates` all call it.
 * Whether the plan allows a preset is boat's call: its 403 names the plan a preset needs.
 */
export function resolveLaunch(inputs: MachineInputs, { templates, defaults }: LaunchChoices): LaunchResolution {
  const template = inputs.template === undefined ? defaults.template : inputs.template;
  const preset = inputs.preset ?? defaults.preset;
  if (template === null) return { ok: true, launch: { template, preset } };

  const found = templates.find((candidate) => candidate.name === template);
  const suffix = inputs.template === undefined ? FROM_SETTING : "";
  if (found === undefined)
    return refuse(`No saved snapshot "${template}" on this boat account${suffix}. Run \`bb boat templates\` to list them.`);
  switch (found.status) {
    case "ready":
      return { ok: true, launch: { template, preset } };
    case "saving":
      return refuse(`Template "${template}" is still saving on boat${suffix}. Start the thread once \`bb boat templates\` shows it ready.`);
    case "failed":
      return refuse(`boat could not save template "${template}"${suffix}: ${found.error}. Save it again with \`boat snapshot <sandbox-id> ${template}\`.`);
    default:
      return found.status satisfies never;
  }
}

const refuse = (message: string): LaunchResolution => ({ ok: false, message });

/** `a small boat sandbox from template node-tools`, for the create step, status and `bb boat templates`. */
export function describeLaunch({ template, preset }: Launch): string {
  const sandbox = `${preset === "xlarge" ? "an" : "a"} ${preset} boat sandbox`;
  return template === null ? `${sandbox} from boat's stock image` : `${sandbox} from template ${template}`;
}
