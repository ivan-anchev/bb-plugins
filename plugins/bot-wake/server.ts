import type { BotWakeHost } from "./bb-types.ts";
import { botWakeCli } from "./cli.ts";
import { deliverWith } from "./delivery.ts";
import { openFailureLog } from "./failure-log.ts";
import { parseRoutes, routesSetting, targetsOf, type Routes } from "./routes.ts";
import { defineTargetSecrets } from "./target-secrets.ts";
import { syncTargetsOnChange } from "./target-sync.ts";
import { createWaker } from "./waker.ts";

export default async function plugin(bb: BotWakeHost) {
  const lifetime = new AbortController();
  bb.onDispose(async () => {
    lifetime.abort();
    // Let the cancelled POSTs reach the failure log before bb closes the database.
    await waker.idle();
  });

  const settings = bb.settings.define(routesSetting);
  const currentRoutes = async () => routesOf((await settings.get()).routes);
  const currentTargets = async () => targetsOf(await currentRoutes());

  const secrets = defineTargetSecrets(bb.settings, await currentTargets());
  const failures = openFailureLog(bb.storage.database(), (db, statements) => bb.storage.migrate(db, statements));
  const deliver = deliverWith(secrets);
  const waker = createWaker({
    routes: currentRoutes,
    pendingInteraction: async (threadId) =>
      (await bb.sdk.threads.interactions.list({ threadId })).find((row) => row.status === "pending") ?? null,
    lastTurnInterrupted: async (threadId) => {
      const [latest] = await bb.sdk.threads.events.list({ threadId, types: ["turn/completed"], order: "desc", limit: "1" });
      return latest?.type === "turn/completed" && latest.data.status === "interrupted";
    },
    deliver,
    failures,
    log: bb.log,
    signal: lifetime.signal,
  });

  bb.events.on("interaction.pending", waker.onInteractionPending);
  bb.events.on("thread.idle", waker.onThreadIdle);
  bb.events.on("thread.failed", waker.onThreadFailed);
  syncTargetsOnChange(bb, { routesSetting: settings, secrets, currentTargets, signal: lifetime.signal });
  bb.cli.register(botWakeCli({ failures, deliver, secrets, signal: lifetime.signal }));
}

function routesOf(text: string): Routes {
  const parsed = parseRoutes(text);
  if (!parsed.ok) throw new Error(`The routes setting is invalid: ${parsed.error}`);
  return parsed.routes;
}
