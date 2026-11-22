import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import { previewOf } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import type { MemoryRoot } from "./memory-files.ts";

type MemoryMethods = Pick<typeof coordinatorContract, "memoryList" | "memoryRead" | "memoryWrite">;

export function memoryHandlers(store: Pick<Store, "coordinator">, memory: MemoryRoot, inbox: Pick<Inbox, "record">): PluginRpcHandlers<MemoryMethods> {
  function of(id: CoordinatorId) {
    if (store.coordinator(id) === null) throw new Error(`There is no started regional manager ${id}.`);
    return memory.of(id);
  }

  return {
    memoryList: ({ coordinatorId }) => {
      const files = of(coordinatorId);
      return {
        files: files.list().flatMap((file) => {
          const text = files.read(file).text;
          const modifiedAt = files.modifiedAt(file);
          return text === null || modifiedAt === null ? [] : [{ file, preview: previewOf(text.content), modifiedAt }];
        }),
      };
    },
    memoryRead: ({ coordinatorId, file }) => of(coordinatorId).read(file),
    memoryWrite: ({ coordinatorId, file, content, baseVersion }) => {
      const outcome = of(coordinatorId).write(file, content, baseVersion);
      if (outcome.outcome === "saved") inbox.record(coordinatorId, { kind: "memory-edited", file });
      return outcome;
    },
  };
}
