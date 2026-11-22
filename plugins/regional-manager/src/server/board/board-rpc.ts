import { experimental_PluginRpcRefusal as Refusal, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import { needsYou } from "../../model/board/board-groups.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import type { BoardReader } from "./board.ts";

type Deps = {
  store: Pick<Store, "coordinator">;
  board: Pick<BoardReader, "read" | "detail" | "needsYou">;
  inbox: Pick<Inbox, "setVerify" | "answerDecision">;
};

type BoardMethods = "board" | "issue" | "needsYou" | "setVerify" | "answerDecision";

export function boardHandlers({ store, board, inbox }: Deps): PluginRpcHandlers<Pick<typeof coordinatorContract, BoardMethods>> {
  const started = (id: CoordinatorId): boolean => store.coordinator(id) !== null;
  function known(id: CoordinatorId): CoordinatorId {
    if (!started(id)) throw new Refusal({ code: "not_found", message: `There is no started regional manager ${id}.` });
    return id;
  }

  return {
    board: ({ coordinatorId }) => board.read(known(coordinatorId)),

    issue: async ({ coordinatorId, issueId }) => {
      const detail = await board.detail(known(coordinatorId), issueId);
      if (detail === null) throw new Refusal({ code: "not_found", message: `This regional manager has no issue ${issueId}.` });
      return detail;
    },

    needsYou: async ({ keys }) => Object.fromEntries(await Promise.all(keys.map(async (id) => [id, started(id) ? await board.needsYou(id) : needsYou([], [])] as const))),

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
