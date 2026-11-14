// What "Add to notes" on a chat message hands the Spotlight. bb shows the action in two places: the
// text-selection menu on assistant replies, which passes the highlighted text, and the action bar
// under every message, which passes none.
import type { PluginMessageActionContext } from "@get-bb/plugin-sdk";
import type { Capture } from "./spotlight-store.ts";

/**
 * The highlighted text, else a whole assistant reply. A user message quotes nothing: the user's own
 * words are not a source, so its action-bar button opens a blank note.
 */
export function captureFrom({ threadId, message, selectedText }: Pick<PluginMessageActionContext, "threadId" | "message" | "selectedText">): Capture | null {
  // why `experimental_messageSeq`, not `sourceSeqEnd`: it is the `msg` a message link opens.
  const messageSeq = message.experimental_messageSeq;
  if (selectedText !== undefined) return { text: selectedText, threadId, messageSeq };
  return message.role === "assistant" ? { text: message.text, threadId, messageSeq } : null;
}
