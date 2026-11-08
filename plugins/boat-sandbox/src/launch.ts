// What a sandbox launches with: the machine inputs (`--machine-inputs`) a thread may pass, resolved
// against the settings. A preset is one of boat's sandbox `type` values.
import { z } from "zod";

export const PRESETS = ["small", "default", "large", "xlarge"] as const;

export type Preset = (typeof PRESETS)[number];

/** Persisted on the launch and readable by every plugin, so it names things and holds no secret. */
export const machineInputs = z.object({ preset: z.enum(PRESETS).optional() }).strict();

export type MachineInputs = z.output<typeof machineInputs>;

export interface Launch {
  preset: Preset;
}

// Whether the plan allows a preset is boat's call: its 403 names the plan a preset needs.
export const resolveLaunch = (inputs: MachineInputs, defaultPreset: Preset): Launch => ({
  preset: inputs.preset ?? defaultPreset,
});
