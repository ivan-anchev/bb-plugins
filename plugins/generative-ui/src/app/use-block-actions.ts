// What a click in a UI block does in bb: @ToAssistant posts the answer to the
// block's thread as a user message, @OpenUrl opens the link the way bb opens links.
// A double-click repeats the answer; only the first one is sent.
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { type ActionEvent, BuiltinActionType } from "@openuidev/react-lang";
import { useRef } from "react";
import { toast } from "sonner";
import { formatActionMessage } from "../action-message.ts";
import { isRepeatedAnswer, type SentAnswer } from "../repeated-answer.ts";

export function useBlockActions(threadId: string): (event: ActionEvent) => void {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const lastAnswer = useRef<SentAnswer>(undefined);

  const sendAnswer = (event: ActionEvent) => {
    const answer = { text: formatActionMessage(event), at: performance.now() };
    if (isRepeatedAnswer(lastAnswer.current, answer)) return;
    lastAnswer.current = answer;
    sdk.threads
      .send({ threadId, mode: "queue-if-active", input: [{ type: "text", text: answer.text, mentions: [] }] })
      .catch((error: unknown) => toast.error("Couldn't send your answer", { description: String(error) }));
  };

  return (event) => {
    if (event.type === BuiltinActionType.ContinueConversation) sendAnswer(event);
    if (event.type === BuiltinActionType.OpenUrl) navigate.openUrl(String(event.params.url));
  };
}
