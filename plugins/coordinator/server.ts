// Composition root. Owns no logic: opens the store and the memory folder, and wires each module
// to bb.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { COORDINATORS_TAG, coordinatorContract } from "./src/contract.ts";
import { openMemoryRoot } from "./src/server/memory/memory-files.ts";
import { registerRoles } from "./src/server/roles.ts";
import { createSpawner } from "./src/server/spawn.ts";
import { openStore } from "./src/server/store.ts";
import { registerCoordinatorTools } from "./src/server/tools/coordinator-tools.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openStore(bb.storage);
  const memory = openMemoryRoot(bb.storage.database().name);
  bb.log.info(`Memory files are in ${memory.dir}`);
  const spawner = createSpawner(bb, store, memory, () => bb.rpc.experimental_invalidate([COORDINATORS_TAG]));

  registerRoles(bb, store);
  registerCoordinatorTools(bb, store, memory);

  bb.rpc.register(coordinatorContract, {
    coordinators: () => ({ coordinators: store.coordinators() }),
    primaryHost: async () => ({ hostId: (await bb.sdk.system.config()).primaryHostId }),
    startCoordinator: ({ request }) => spawner.coordinator(request),
  });
}
