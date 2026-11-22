import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ACTIVITY_TAG, activityContract, burnContract } from "./contract.ts";
import { describeFailure, readMergedPrs } from "./activity/github.ts";
import { createSnapshot } from "./activity/snapshot.ts";
import { readThreadStarts } from "./activity/threads.ts";
import { readBurnSpend } from "./burn/spend.ts";

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
  bb.rpc.register(burnContract, {
    burnSpend: ({ range }, context) => readBurnSpend(bb.sdk.plugins.callRpc, range, context.experimental_signal),
  });

  bb.background.service("warm-activity", {
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
