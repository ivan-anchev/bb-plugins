// Composition root: wires the modules and owns no logic of its own.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { prReviewsContract } from "./src/contract.ts";
import { createRpcHandlers } from "./src/server/rpc-handlers.ts";

export default function plugin(bb: BbPluginApi): void {
  bb.rpc.register(prReviewsContract, createRpcHandlers(bb));
}
