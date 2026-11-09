// What a sandbox launches with. A preset is one of boat's sandbox `type` values.
export const PRESETS = ["small", "default", "large", "xlarge"] as const;

export type Preset = (typeof PRESETS)[number];
