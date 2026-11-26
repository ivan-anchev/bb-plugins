// Answering a decision the regional manager put to the user, from its card in its issue's feed
// (issue-tab/feed/decision/decision-card.tsx).
import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { DecisionId } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";

/**
 * Sends one answer at a time: `sent` is the answer sent, from the press until the board reads the
 * decision answered (null: none on its way, or the send failed, whose error is `error`).
 */
export function useAnswer(coordinatorId: CoordinatorId, decisionId: DecisionId) {
  const save = experimental_useRpcMutation({ contract, method: "answerDecision" });
  const [sent, setSent] = useState<string | null>(null);

  /** Sends `text`, unless an answer is on its way or it is blank; whether it went. */
  function send(text: string): boolean {
    if (sent !== null || text.trim() === "") return false;
    setSent(text);
    // why the catch: the hook's error shows beside the answer; the rejection carries nothing more.
    save.mutate({ coordinatorId, decisionId, answer: text }).catch(() => setSent(null));
    return true;
  }

  return { sent, send, error: sent === null ? save.error : null };
}
