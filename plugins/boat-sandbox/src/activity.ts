// What counts as work on a boat machine besides a busy thread, which the sweep counts itself:
// input in one of its terminals, and a turn ending on it.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { IdleClock } from "./idle-clock.ts";
import { PROVIDER_ID } from "./contract.ts";

export function trackActivity(bb: Pick<BbPluginApi, "events" | "sdk">, idle: IdleClock): void {
  async function touchIfOwned(hostId: string): Promise<void> {
    const host = await bb.sdk.hosts.get({ hostId });
    if (host.machineProviderId === PROVIDER_ID && host.lifecycle.phase === "active") await idle.touch(hostId);
  }

  bb.events.on("experimental_terminal.input", ({ terminal }) => touchIfOwned(terminal.hostId));
  // A turn shorter than a minute can start and end between two sweeps, so idle time counts from its end.
  bb.events.on("thread.idle", async ({ thread }) => {
    if (thread.environmentId === null) return;
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    await touchIfOwned(environment.hostId);
  });
  bb.events.on("experimental_host.deleted", ({ host }) => idle.forget(host.id));
}
