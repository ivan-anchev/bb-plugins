import type { BotWakeSettings, SecretPairDescriptors } from "./bb-types.ts";
import type { Target } from "./routes.ts";

/** Where a target's webhook lives and the key it is sent with. Never logged or printed. */
export interface Endpoint {
  url: string;
  key: string;
}

/** A target's endpoint, or the names of the settings still unset (names only, never values). */
export type EndpointLookup =
  | { ok: true; endpoint: Endpoint }
  | { ok: false; missing: readonly string[] };

export interface TargetSecrets {
  /** The routed targets, as declared at load. */
  targets: readonly Target[];
  endpoint(target: Target): Promise<EndpointLookup>;
  /** Deletes the target's stored URL and key (its 0600 files). */
  unset(target: Target): Promise<void>;
}

function secretKeys(target: Target): { url: string; key: string } {
  return { url: `BOT_WAKE_${target}_URL`, key: `BOT_WAKE_${target}_KEY` };
}

/**
 * Declares the two native secret settings of every target. bb reads setting
 * names when the factory runs, so a new target's fields appear only after the
 * plugin reloads.
 */
export function defineTargetSecrets(settings: BotWakeSettings, targets: readonly Target[]): TargetSecrets {
  const handles = new Map(targets.map((target) => [target, defineSecretPair(settings, target)]));

  return {
    targets,
    async endpoint(target) {
      const handle = handles.get(target);
      if (handle === undefined) return { ok: false, missing: Object.values(secretKeys(target)) };
      const names = secretKeys(target);
      const values = await handle.get();
      const url = values[names.url];
      const key = values[names.key];
      if (url && key) return { ok: true, endpoint: { url, key } };
      return { ok: false, missing: [!url && names.url, !key && names.key].filter((name) => name !== false) };
    },
    async unset(target) {
      const names = secretKeys(target);
      await handles.get(target)?.experimental_set({ [names.url]: null, [names.key]: null });
    },
  };
}

function defineSecretPair(settings: BotWakeSettings, target: Target) {
  const names = secretKeys(target);
  const descriptors: SecretPairDescriptors = {
    [names.url]: {
      type: "string",
      secret: true,
      label: `${target} webhook URL`,
      description: `Where events routed to ${target} are POSTed.`,
    },
    [names.key]: {
      type: "string",
      secret: true,
      label: `${target} sender key`,
      description: `Sent as the Bearer token and X-Automation-Key header.`,
    },
  };
  return settings.define(descriptors);
}
