// The Board's RPC, for a started regional manager: its read, what of it needs the user, its verification
// switch, and the user's answers to its decisions; and its open work, published to other plugins.
import { experimental_PluginRpcRefusal as Refusal, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract, publishedContract } from "../../contract.ts";
import type { Decision } from "../../model/decision.ts";
import { isClosed } from "../../model/issue/relations.ts";
import { STATUS_LABELS, type IssueView } from "../../model/issue/status.ts";
import { stillWaits } from "../../model/verdict/rounds/cap.ts";
import type { CurrentViews } from "../issues/views/current-views.ts";
import { openIssues } from "../../model/board/open-issues.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import type { BoardReader } from "./board.ts";

type Deps = {
  store: Pick<Store, "coordinator" | "decisions">;
  board: Pick<BoardReader, "read" | "needsYou" | "openIssues">;
  inbox: Pick<Inbox, "setVerify" | "answerDecision">;
  /** Reads the issues for an answer to the plugin's question at a cap, which an issue's close lapses. */
  views: Pick<CurrentViews, "whileCurrent">;
};

type BoardMethods = "board" | "needsYou" | "setVerify" | "answerDecision";

export function boardHandlers({ store, board, inbox, views }: Deps): PluginRpcHandlers<Pick<typeof coordinatorContract, BoardMethods>> {
  // why refuse an unknown id, or one not started: it would read as a board with no issues, and one not started has no board.
  const started = (id: CoordinatorId): boolean => store.coordinator(id) !== null;
  function known(id: CoordinatorId): CoordinatorId {
    if (!started(id)) throw new Refusal({ code: "not_found", message: `There is no started regional manager ${id}.` });
    return id;
  }

  return {
    board: ({ coordinatorId }) => board.read(known(coordinatorId)),

    // why no issue needs the user for an unknown id, or one not started, rather than a refusal: the keys come from the coordinators read, and one refusal would fail every key read with it.
    needsYou: async ({ keys }) => Object.fromEntries(await Promise.all(keys.map(async (id) => [id, started(id) ? await board.needsYou(id) : 0] as const))),

    setVerify: ({ coordinatorId, verify }) => {
      inbox.setVerify(known(coordinatorId), verify);
      return {};
    },

    answerDecision: async ({ coordinatorId, decisionId, answer }) => {
      const id = known(coordinatorId);
      const asked = () => store.decisions(id).find((decision) => decision.id === decisionId);
      // why the question read again and answered inside the act: a close while bb is read makes the read stale, so the views it is judged by are those the answer is written beside.
      const answerUnlessLapsed = (current: readonly IssueView[]): AnswerOutcome => {
        const lapsed = lapsedText(asked(), current);
        return lapsed === null ? inbox.answerDecision(id, decisionId, answer) : { lapsed };
      };
      // why the views only for the plugin's question at a cap: no other question lapses, so answering one needs nothing of bb.
      const answered = (asked()?.cap ?? null) === null ? { acted: inbox.answerDecision(id, decisionId, answer) } : await views.whileCurrent(id, answerUnlessLapsed);
      if (answered === null) throw new Refusal({ code: "conflict", message: `${decisionId} wasn't answered: the issues kept changing while they were read. Try again.` });
      const outcome = answered.acted;
      if (typeof outcome === "object") throw new Refusal({ code: "conflict", message: outcome.lapsed });
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

/** What answering a decision did (see answerDecision), or why it no longer takes an answer (see lapsedText). */
type AnswerOutcome = ReturnType<Inbox["answerDecision"]> | { lapsed: string };

/**
 * Why a question no longer takes an answer: the plugin's question at an issue's cap, unanswered, once
 * its issue closed (rounds/cap.ts stillWaits), as `views` place it. null when it takes one, or when
 * the store judges it (none by that id, or answered).
 */
function lapsedText(decision: Decision | undefined, views: readonly IssueView[]): string | null {
  if (decision === undefined || decision.issueId === null) return null;
  const status = views.find(({ issue }) => issue.id === decision.issueId)?.status ?? null;
  if (decision.answer !== null || status === null || stillWaits(decision, isClosed(status))) return null;
  return `${decision.id} no longer takes an answer: ${decision.issueId} is ${STATUS_LABELS[status]}, so no round is left for it to allow.`;
}

/** Each board's open work, for another plugin. why none for an unknown id, or one not started, as needsYou: one refusal would fail every key read with it. */
export function openIssuesHandler({ store, board }: Pick<Deps, "store" | "board">): PluginRpcHandlers<Pick<typeof publishedContract, "openIssues">> {
  return {
    openIssues: async ({ keys }) => Object.fromEntries(await Promise.all(keys.map(async (id) => [id, store.coordinator(id) === null ? openIssues([], []) : await board.openIssues(id)] as const))),
  };
}
