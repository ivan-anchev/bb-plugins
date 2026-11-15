// The Board's RPC, for a coordinating thread the store knows: its read, and the user's edits and
// Starts of its drafts.
import { experimental_PluginRpcRefusal as Refusal, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { typedText, type coordinatorContract } from "../../contract.ts";
import { briefSchema, type DraftEdit } from "../../model/crew.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store.ts";
import type { BoardReader } from "./board.ts";
import type { Crews } from "./crews.ts";

type Deps = {
  store: Pick<Store, "isCoordinator" | "coordinator">;
  board: Pick<BoardReader, "read">;
  crews: Pick<Crews, "updateDraft" | "startDraft">;
};

export function boardHandlers({ store, board, crews }: Deps): PluginRpcHandlers<Pick<typeof coordinatorContract, "board" | "updateDraft" | "startDraft">> {
  // why refuse an unknown id: it would read as a board with no crews.
  function known(id: CoordinatorId): CoordinatorId {
    if (!store.isCoordinator(id)) throw new Refusal({ code: "not_found", message: `There is no coordinating thread ${id}.` });
    return id;
  }

  return {
    board: ({ coordinatorId }) => board.read(known(coordinatorId)),

    updateDraft: ({ coordinatorId, crewId, request, doneCriteria }) => {
      const coordinator = store.coordinator(known(coordinatorId));
      if (coordinator === null) throw new Refusal({ code: "not_found", message: `The coordinating thread ${coordinatorId} has no thread.` });
      crews.updateDraft(coordinatorId, crewId, draftEdit(coordinator.projectId, request, doneCriteria));
      return {};
    },

    startDraft: async ({ coordinatorId, crewId }) => {
      const launch = await crews.startDraft(known(coordinatorId), crewId);
      if (launch.kind === "failed") throw new Error(`bb did not start its thread: ${launch.error}`);
      return { threadId: launch.threadId };
    },
  };
}

/** What bb's composer submitted for a draft, as the draft keeps it; refused when a draft can't hold it. */
function draftEdit(projectId: string, request: NewThreadRequest, doneCriteria: string[]): DraftEdit {
  if (request.projectId !== projectId) throw new Refusal({ code: "invalid", message: "A crew works in its coordinating thread's project: pick that project again." });
  if (request.input.some((part) => part.type !== "text")) throw new Refusal({ code: "invalid", message: "A brief is text only: remove the attachment." });
  const brief = briefSchema.safeParse(typedText(request));
  if (!brief.success) throw new Refusal({ code: "invalid", message: "A brief needs 1 to 20,000 characters." });
  const { providerId, model, reasoningLevel, permissionMode, serviceTier, sessionOptions, executionInputSources, environment } = request;
  return {
    brief: brief.data,
    doneCriteria,
    execution: { providerId, model, reasoningLevel, permissionMode, serviceTier, sessionOptions, executionInputSources },
    placement: { kind: "chosen", environment },
  };
}
