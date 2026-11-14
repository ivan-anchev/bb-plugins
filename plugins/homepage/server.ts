// Composition root: keeps each card's data warm and serves it to the homepage.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ACTIVITY_TAG, activityContract } from "./contract.ts";
import { describeFailure, readMergedPrs } from "./activity/github.ts";
import { createSnapshot } from "./activity/snapshot.ts";
import { readThreadStarts } from "./activity/threads.ts";

export default function plugin(bb: BbPluginApi): void {
  const snapshot = createSnapshot({
    kv: bb.storage.kv,
    readMergedPrs,
    readThreadStarts: (since) => readThreadStarts(bb.sdk, since),
    describeFailure,
    onRefreshed: () => bb.rpc.experimental_invalidate([ACTIVITY_TAG]),
    warn: (message) => bb.log.warn(message),
    now: Date.now,
  });

  bb.rpc.register(activityContract, { activity: () => snapshot.read() });

  // Warm on every server start, then every 30 minutes, so opening New thread never waits on GitHub.
  bb.background.service("warm-activity", {
    // why: the refresh is not awaited. Awaiting it meant a reload mid-refresh (GitHub can take 15 s)
    // aborted the signal before the listener below existed, so the run never ended and bb refused
    // to reload the plugin until the server restarted.
    async start(signal) {
      snapshot.refresh().catch((error: unknown) => bb.log.warn(`Activity refresh failed: ${String(error)}`));
      await new Promise((resolve) => {
        if (signal.aborted) resolve(undefined);
        else signal.addEventListener("abort", resolve, { once: true });
      });
    },
  });
  bb.background.schedule("refresh-activity", "*/30 * * * *", () => snapshot.refresh().then(() => undefined));
}
