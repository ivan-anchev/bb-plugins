// boat Sandbox's settings, shown under Settings → boat Sandbox.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PRESETS, snapshotName, type DefaultSetting, type LaunchDefaults } from "./launch.ts";
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
    defaultTemplate: {
      type: "string",
      label: "Default template",
      description:
        "A boat saved snapshot new machines start from when a thread names none; `bb boat templates` lists them. Empty uses boat's stock image.",
      default: "",
    },
    defaultEnvironment: {
      type: "string",
      label: "Default environment",
      description:
        "The boat environment new machines start in when a thread names none; it decides the sign-ins, GitHub token and secrets the sandbox gets. `bb boat templates` lists them. Empty uses boat's default environment.",
      default: "",
    },
    // Read by the app only; the server never looks at it.
    sidebarIcon: {
      type: "boolean",
      label: "Boat icon in the sidebar",
      description: "Mark each thread that runs on a boat sandbox with a boat icon on its sidebar row.",
      default: true,
    },
  });

export type BoatSettings = ReturnType<typeof defineBoatSettings>;
export type BoatSettingsValues = Awaited<ReturnType<BoatSettings["get"]>>;

export type ResolvedSettings =
  | { ok: true; apiKey: string; idleMs: number | null; defaults: LaunchDefaults }
  | { ok: false; problem: Problem };

/**
 * Parses the stored settings once; everything inward trusts ResolvedSettings. Only the Default
 * template's syntax is checked here: whether boat has it, or the Default environment, is
 * resolveLaunch's call, at each launch.
 */
export function resolveSettings(values: BoatSettingsValues): ResolvedSettings {
  const apiKey = values.apiKey?.trim() ?? "";
  if (apiKey === "") return { ok: false, problem: missingKey() };

  const { idleMinutes } = values;
  if (!Number.isInteger(idleMinutes) || idleMinutes < 0 || idleMinutes > MAX_IDLE_MINUTES)
    return { ok: false, problem: invalidIdleMinutes(idleMinutes) };

  const preset = z.enum(PRESETS).safeParse(values.defaultPreset);
  if (!preset.success) return { ok: false, problem: invalidPreset(values.defaultPreset) };

  const template = values.defaultTemplate.trim();
  if (template !== "" && !snapshotName.safeParse(template).success) return { ok: false, problem: invalidTemplate(template) };

  const environment = values.defaultEnvironment.trim();

  return {
    ok: true,
    apiKey,
    idleMs: idleMinutes === 0 ? null : idleMinutes * 60_000,
    defaults: { template: template === "" ? null : template, environment: environment === "" ? null : environment, preset: preset.data },
  };
}

/** How to point a default setting at a name boat has, or back at boat's own default. */
export const DEFAULT_STEPS: Record<DefaultSetting, string> = {
  defaultTemplate:
    "Run `bb plugin config boat-sandbox set defaultTemplate <name>` with a template `bb boat templates` lists, " +
    "or `bb plugin config boat-sandbox unset defaultTemplate` for boat's stock image",
  defaultEnvironment:
    "Run `bb plugin config boat-sandbox set defaultEnvironment <name>` with an environment `bb boat templates` lists, " +
    "or `bb plugin config boat-sandbox unset defaultEnvironment` for boat's default environment",
};

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

const invalidTemplate = (template: string): Problem =>
  problem(
    `Default template "${template}" is not a boat saved-snapshot name (lowercase letters, digits and dashes).`,
    DEFAULT_STEPS.defaultTemplate,
  );
