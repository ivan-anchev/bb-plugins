// The Memory editor's reads and writes: the same files and the same compare-and-swap as the
// Coordinator's tools, for a coordinating thread the store knows. A save wakes the thread.
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import type { MemoryRoot } from "./memory-files.ts";

type MemoryMethods = Pick<typeof coordinatorContract, "memoryList" | "memoryRead" | "memoryWrite">;

export function memoryHandlers(store: Pick<Store, "isCoordinator">, memory: MemoryRoot, inbox: Pick<Inbox, "record">): PluginRpcHandlers<MemoryMethods> {
  // why refuse an unknown id: its memory would read as an empty folder, and a write would make one.
  function of(id: CoordinatorId) {
    if (!store.isCoordinator(id)) throw new Error(`There is no regional manager ${id}.`);
    return memory.of(id);
  }

  return {
    memoryList: ({ coordinatorId }) => {
      const files = of(coordinatorId);
      return { dir: files.dir, files: files.list() };
    },
    memoryRead: ({ coordinatorId, file }) => of(coordinatorId).read(file),
    memoryWrite: ({ coordinatorId, file, content, baseVersion }) => {
      const outcome = of(coordinatorId).write(file, content, baseVersion);
      if (outcome.outcome === "saved") inbox.record(coordinatorId, { kind: "memory-edited", file });
      return outcome;
    },
  };
}
