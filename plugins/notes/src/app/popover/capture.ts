import type { PluginMessageActionContext } from "@get-bb/plugin-sdk";
import type { Capture } from "./popover-store.ts";

/**
 * The highlighted text, else a whole assistant reply. A user message quotes nothing: the user's own
 * words are not a source, so its action-bar button opens a blank note.
 */
export function captureFrom({ threadId, message, selectedText }: Pick<PluginMessageActionContext, "threadId" | "message" | "selectedText">): Capture | null {
  const messageSeq = message.experimental_messageSeq;
  if (selectedText !== undefined) return { text: selectedText, threadId, messageSeq };
  return message.role === "assistant" ? { text: message.text, threadId, messageSeq } : null;
}
