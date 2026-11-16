// Composition root. Owns no logic: opens the store and the memory folder, and wires each module
// to bb.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { boardTag, COORDINATORS_TAG, coordinatorContract, memoryTag } from "./src/contract.ts";
import type { CoordinatorId, Role } from "./src/model/role.ts";
import { boardHandlers } from "./src/server/crew/board-rpc.ts";
import { createBoard } from "./src/server/crew/board.ts";
import { createCrews } from "./src/server/crew/crews.ts";
import { forwardCrewThreadEvents } from "./src/server/crew/thread-events.ts";
import { createInbox } from "./src/server/inbox/inbox.ts";
import { watchCrewThreads } from "./src/server/inbox/thread-watch.ts";
import { openMemoryRoot } from "./src/server/memory/memory-files.ts";
import { memoryHandlers } from "./src/server/memory/memory-rpc.ts";
import { registerRoles } from "./src/server/roles.ts";
import { createSpawner } from "./src/server/spawn.ts";
import { openStore } from "./src/server/store.ts";
import { registerCoordinatorTools } from "./src/server/tools/coordinator-tools.ts";
import { registerCrewTools } from "./src/server/tools/crew-tools.ts";
import { registerVerdictTool } from "./src/server/verify/verdict-tool.ts";
import { createVerify } from "./src/server/verify/verify.ts";
import { runGh } from "./src/server/watch/host-command.ts";
import { createPrWatch } from "./src/server/watch/pr-watch.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openStore(bb.storage);
  const memory = openMemoryRoot(bb.storage.database().name, store, (id) => bb.rpc.experimental_invalidate([memoryTag(id)]));
  bb.log.info(`Memory files are in ${memory.dir}`);
  const refreshBoard = (id: CoordinatorId) => bb.rpc.experimental_invalidate([boardTag(id)]);
  const spawner = createSpawner(bb, store, memory, (role: Role) => bb.rpc.experimental_invalidate([role.kind === "coordinator" ? COORDINATORS_TAG : boardTag(role.coordinatorId)]));
  const board = createBoard(bb, store, memory);
  const crews = createCrews({ bb, store, spawner, onChange: refreshBoard });
  const inbox = createInbox({ bb, store, onChange: refreshBoard });
  const verify = createVerify({ bb, store, spawner, inbox });

  registerRoles(bb, store);
  registerCoordinatorTools(bb, { store, inbox, memory, crews, board, onChange: refreshBoard });
  registerCrewTools(bb, { store, verify });
  registerVerdictTool(bb, { store, verify });
  forwardCrewThreadEvents(bb, store, refreshBoard);
  watchCrewThreads({ bb, store, inbox, onChange: refreshBoard });
  const prWatch = createPrWatch({ bb, store, inbox, gh: runGh });
  bb.background.schedule("watch", "* * * * *", async () => {
    // why each caught: a pass that can't read bb or GitHub must not keep the next from running, nor the doorbells from ringing.
    await prWatch.tick(Date.now()).catch((error: unknown) => bb.log.warn(`Could not read the crews' pull requests; the next tick tries again: ${messageOf(error)}`));
    await verify.reconcile().catch((error: unknown) => bb.log.warn(`Could not reconcile the verifiers; the next tick tries again: ${messageOf(error)}`));
    await inbox.tick(Date.now());
  });

  bb.rpc.register(coordinatorContract, {
    coordinators: () => ({ coordinators: store.coordinators() }),
    primaryHost: async () => ({ hostId: (await bb.sdk.system.config()).primaryHostId }),
    startCoordinator: ({ request, verify }) => spawner.coordinator(request, verify),
    ...boardHandlers({ store, board, crews, inbox }),
    ...memoryHandlers(store, memory, inbox),
  });
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
