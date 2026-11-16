// The Board's read, for a coordinating thread the store knows.
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import type { Store } from "../store.ts";
import type { BoardReader } from "./board.ts";

export function boardHandlers(store: Pick<Store, "isCoordinator">, board: Pick<BoardReader, "read">): PluginRpcHandlers<Pick<typeof coordinatorContract, "board">> {
  return {
    board: ({ coordinatorId }) => {
      // why refuse an unknown id: it would read as a board with no crews.
      if (!store.isCoordinator(coordinatorId)) throw new Error(`There is no coordinating thread ${coordinatorId}.`);
      return board.read(coordinatorId);
    },
  };
}
