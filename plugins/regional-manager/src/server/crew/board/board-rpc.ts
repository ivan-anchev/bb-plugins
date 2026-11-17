// The Board's RPC, for a coordinating thread the store knows: its read and what of it needs the
// user, its verification switch, and the user's answers to its decisions.
import { experimental_PluginRpcRefusal as Refusal, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../../contract.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Inbox } from "../../inbox/inbox.ts";
import type { Store } from "../../store.ts";
import type { BoardReader } from "./board.ts";

type Deps = {
  store: Pick<Store, "isCoordinator">;
  board: Pick<BoardReader, "read" | "needsYou">;
  inbox: Pick<Inbox, "setVerify" | "answerDecision">;
};

type BoardMethods = "board" | "needsYou" | "setVerify" | "answerDecision";

export function boardHandlers({ store, board, inbox }: Deps): PluginRpcHandlers<Pick<typeof coordinatorContract, BoardMethods>> {
  // why refuse an unknown id: it would read as a board with no crews.
  function known(id: CoordinatorId): CoordinatorId {
    if (!store.isCoordinator(id)) throw new Refusal({ code: "not_found", message: `There is no regional manager ${id}.` });
    return id;
  }

  return {
    board: ({ coordinatorId }) => board.read(known(coordinatorId)),

    // why no refusal for an unknown id: the keys come from the coordinators read, and one refusal would fail every key read with it.
    needsYou: async ({ keys }) => Object.fromEntries(await Promise.all(keys.map(async (id) => [id, await board.needsYou(id)] as const))),

    setVerify: ({ coordinatorId, verify }) => {
      inbox.setVerify(known(coordinatorId), verify);
      return {};
    },

    answerDecision: ({ coordinatorId, decisionId, answer }) => {
      const outcome = inbox.answerDecision(known(coordinatorId), decisionId, answer);
      switch (outcome) {
        case "answered":
          return {};
        case "already-answered":
          throw new Refusal({ code: "conflict", message: `${decisionId} was already answered; an answer can't be changed.` });
        case "unknown":
          throw new Refusal({ code: "not_found", message: `This regional manager has no decision ${decisionId}.` });
        default:
          return outcome satisfies never;
      }
    },
  };
}
