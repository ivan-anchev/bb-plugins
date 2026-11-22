import type { PluginSettingsHandle } from "@get-bb/plugin-sdk";
import type { BotWakeHost, RoutesDescriptors } from "./bb-types.ts";
import type { Target } from "./routes.ts";
import type { TargetSecrets } from "./target-secrets.ts";

interface TargetSyncDeps {
  routesSetting: PluginSettingsHandle<RoutesDescriptors>;
  secrets: TargetSecrets;
  /** The targets the routes name now, read fresh on every call. */
  currentTargets(): Promise<Target[]>;
  /** Aborts when the plugin instance unloads; stops a sync between steps. */
  signal: AbortSignal;
}

/**
 * Keeps the declared secret fields in step with `routes`. bb declares setting
 * fields when the factory runs, so a target added to `routes` gets its fields
 * only after a reload. A dropped target's secrets are unset first, while its
 * fields are still declared: once undeclared, nothing can delete their files.
 */
export function syncTargetsOnChange(bb: BotWakeHost, deps: TargetSyncDeps) {
  let syncing = false;

  deps.routesSetting.onChange(() => {
    if (syncing) return;
    syncing = true;
    setTimeout(() => {
      applyRoutesChange(bb, deps).then(
        (reloaded) => {
          syncing = reloaded;
        },
        (error: Error) => {
          syncing = false;
          bb.log.error(`could not apply the routes change: ${error.message}`);
        },
      );
    }, 0);
  });
}

async function applyRoutesChange(bb: BotWakeHost, { secrets, currentTargets, signal }: TargetSyncDeps) {
  const unset: Target[] = [];
  while (!signal.aborted) {
    const latest = await currentTargets();
    if (signal.aborted) break;
    const dropped = secrets.targets.find((target) => !latest.includes(target) && !unset.includes(target));
    if (dropped === undefined) {
      if (latest.join() === secrets.targets.join()) return false;
      bb.log.info(`targets changed; reloading${unset.length > 0 ? ` (unset ${unset.join(", ")})` : ""}`);
      await bb.sdk.plugins.reload({ pluginId: bb.pluginId });
      return true;
    }
    await secrets.unset(dropped);
    unset.push(dropped);
  }
  return false;
}
