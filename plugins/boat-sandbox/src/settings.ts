// boat Sandbox's settings, shown under Settings → boat Sandbox.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PRESETS, type Preset } from "./launch.ts";
import { problem, type Problem } from "./problem.ts";

const MAX_IDLE_MINUTES = 1440;

export const defineBoatSettings = (bb: BbPluginApi) =>
  bb.settings.define({
    apiKey: {
      type: "string",
      label: "API key",
      description: "Make one with: boat api-key create bb --preset ci. Stored as a secret and never shown again.",
      secret: true,
    },
    idleMinutes: {
      type: "number",
      label: "Stop after idle (minutes)",
      description: "Stop a sandbox when no thread on it has worked for this long. 0 never stops it for being idle.",
      default: 15,
    },
    defaultPreset: {
      type: "select",
      label: "Default size",
      description: "The boat sandbox type new machines use when a thread names none.",
      options: [...PRESETS],
      default: "default",
    },
  });

export type BoatSettings = ReturnType<typeof defineBoatSettings>;
export type BoatSettingsValues = Awaited<ReturnType<BoatSettings["get"]>>;

export type ResolvedSettings =
  | { ok: true; apiKey: string; idleMs: number | null; defaultPreset: Preset }
  | { ok: false; problem: Problem };

/** Parses the stored settings once; everything inward trusts ResolvedSettings. */
export function resolveSettings(values: BoatSettingsValues): ResolvedSettings {
  const apiKey = values.apiKey?.trim() ?? "";
  if (apiKey === "") return { ok: false, problem: missingKey() };

  const { idleMinutes } = values;
  if (!Number.isInteger(idleMinutes) || idleMinutes < 0 || idleMinutes > MAX_IDLE_MINUTES)
    return { ok: false, problem: invalidIdleMinutes(idleMinutes) };

  const preset = z.enum(PRESETS).safeParse(values.defaultPreset);
  if (!preset.success) return { ok: false, problem: invalidPreset(values.defaultPreset) };

  return {
    ok: true,
    apiKey,
    idleMs: idleMinutes === 0 ? null : idleMinutes * 60_000,
    defaultPreset: preset.data,
  };
}

/** How to put a working key in place. */
export const PASTE_KEY_STEP =
  "Paste a key from `boat api-key create bb --preset ci` into Settings → boat Sandbox → API key";

const missingKey = (): Problem => problem("No boat API key is set.", PASTE_KEY_STEP);

const invalidIdleMinutes = (idleMinutes: number): Problem =>
  problem(
    `Stop after idle is ${idleMinutes} minutes; it must be a whole number from 0 to ${MAX_IDLE_MINUTES}.`,
    "Run `bb plugin config boat-sandbox set idleMinutes 15`",
  );

const invalidPreset = (preset: string): Problem =>
  problem(
    `Default size "${preset}" is not one of ${PRESETS.join(", ")}.`,
    "Run `bb plugin config boat-sandbox set defaultPreset default`",
  );
