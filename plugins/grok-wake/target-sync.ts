import type { PluginSettingsHandle } from "@get-bb/plugin-sdk";
import type { GrokWakeHost, RoutesDescriptors } from "./bb-types.ts";
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
export function syncTargetsOnChange(bb: GrokWakeHost, deps: TargetSyncDeps) {
  // One sync at a time: onChange also fires for the sync's own unsets, and the
  // sync re-reads routes, so writes that land while it runs are not lost.
  let syncing = false;

  deps.routesSetting.onChange(() => {
    if (syncing) return;
    syncing = true;
    // Deferred so the settings write that fired onChange finishes first. An
    // instance unloaded meanwhile finds its signal aborted and does nothing.
    setTimeout(() => {
      applyRoutesChange(bb, deps).then(
        (reloaded) => {
          // A reload replaces this instance; otherwise the next write syncs again.
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

/**
 * Unsets the secrets of the declared targets the routes dropped, one at a
 * time, choosing each from a fresh read of routes so a target restored while
 * an earlier unset was pending keeps its secrets. Once none is left, reloads if
 * the routed targets differ from the declared ones. Stops before any further
 * write once the instance unloads. Returns whether it reloaded.
 */
async function applyRoutesChange(bb: GrokWakeHost, { secrets, currentTargets, signal }: TargetSyncDeps) {
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
