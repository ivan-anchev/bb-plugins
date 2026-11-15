// Composition root. Owns no logic: opens the store and the memory folder, and wires each module
// to bb.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { boardTag, COORDINATORS_TAG, coordinatorContract, memoryTag } from "./src/contract.ts";
import type { CoordinatorId, Role } from "./src/model/role.ts";
import { boardHandlers } from "./src/server/crew/board-rpc.ts";
import { createBoard } from "./src/server/crew/board.ts";
import { createCrews } from "./src/server/crew/crews.ts";
import { forwardCrewThreadEvents } from "./src/server/crew/thread-events.ts";
import { openMemoryRoot } from "./src/server/memory/memory-files.ts";
import { memoryHandlers } from "./src/server/memory/memory-rpc.ts";
import { registerRoles } from "./src/server/roles.ts";
import { createSpawner } from "./src/server/spawn.ts";
import { openStore } from "./src/server/store.ts";
import { registerCoordinatorTools } from "./src/server/tools/coordinator-tools.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openStore(bb.storage);
  const memory = openMemoryRoot(bb.storage.database().name, store, (id) => bb.rpc.experimental_invalidate([memoryTag(id)]));
  bb.log.info(`Memory files are in ${memory.dir}`);
  const refreshBoard = (id: CoordinatorId) => bb.rpc.experimental_invalidate([boardTag(id)]);
  const spawner = createSpawner(bb, store, memory, (role: Role) => bb.rpc.experimental_invalidate([role.kind === "coordinator" ? COORDINATORS_TAG : boardTag(role.coordinatorId)]));
  const board = createBoard(bb, store, memory);
  const crews = createCrews({ bb, store, spawner, onChange: refreshBoard });

  registerRoles(bb, store);
  registerCoordinatorTools(bb, { store, memory, crews, board });
  forwardCrewThreadEvents(bb, store, refreshBoard);

  bb.rpc.register(coordinatorContract, {
    coordinators: () => ({ coordinators: store.coordinators() }),
    primaryHost: async () => ({ hostId: (await bb.sdk.system.config()).primaryHostId }),
    startCoordinator: ({ request }) => spawner.coordinator(request),
    ...boardHandlers({ store, board, crews }),
    ...memoryHandlers(store, memory),
  });
}
