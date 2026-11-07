// Composition root: wires the modules and owns no logic of its own.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { prReviewsContract } from "./src/contract.ts";
import { snapshotPrDiff } from "./src/github/gh.ts";
import { fetchPrCommits } from "./src/github/pr-commits.ts";
import { registerHideReviewThreads } from "./src/server/hide-review-threads.ts";
import { createReviewReader } from "./src/server/review-reader.ts";
import { createReviews } from "./src/server/reviews.ts";
import { createRpcHandlers } from "./src/server/rpc-handlers.ts";
import { defineReviewSettings } from "./src/server/settings.ts";
import { openStore } from "./src/server/store.ts";
import { registerSubmitReviewTool } from "./src/server/submit-review-tool.ts";
import { forwardReviewThreadEvents } from "./src/server/thread-events.ts";

export default function plugin(bb: BbPluginApi): void {
  const settings = defineReviewSettings(bb);
  const store = openStore(bb.storage);
  const reader = createReviewReader({ bb, store });
  const reviews = createReviews({ bb, store, settings, reader, github: { snapshotPrDiff, fetchPrCommits } });
  registerSubmitReviewTool(bb, store);
  bb.rpc.register(prReviewsContract, createRpcHandlers({ bb, store, reader, reviews }));
  forwardReviewThreadEvents(bb, store);
  registerHideReviewThreads(bb);
}
