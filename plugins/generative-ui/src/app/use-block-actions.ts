// What a click in a UI block does in bb: @ToAssistant posts the answer to the
// block's thread as a user message, @OpenUrl opens the link the way bb opens links.
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { type ActionEvent, BuiltinActionType } from "@openuidev/react-lang";
import { toast } from "sonner";
import { formatActionMessage } from "../action-message.ts";

export function useBlockActions(threadId: string): (event: ActionEvent) => void {
  const sdk = useSdk();
  const navigate = useBbNavigate();

  const sendAnswer = (event: ActionEvent) => {
    const text = formatActionMessage(event);
    sdk.threads
      .send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] })
      .catch((error: unknown) => toast.error("Couldn't send your answer", { description: String(error) }));
  };

  return (event) => {
    if (event.type === BuiltinActionType.ContinueConversation) sendAnswer(event);
    if (event.type === BuiltinActionType.OpenUrl) navigate.openUrl(String(event.params.url));
  };
}
