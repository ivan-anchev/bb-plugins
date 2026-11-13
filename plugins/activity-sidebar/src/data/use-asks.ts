// What a mounted row's thread asks while it waits for you: read from bb only while it waits.
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { askOf, type AskKind } from "../model/state.ts";
import { useRead } from "./use-read.ts";

/**
 * Approval or question while the thread has a pending interaction; null while it has none, while
 * the read is out, or when it failed (the row then shows Awaiting Input). Read again whenever the
 * thread moves.
 */
export function useAsk(thread: PluginSidebarThread): AskKind | null {
  const sdk = useSdk();
  const key = thread.hasPendingInteraction ? `${thread.id}@${thread.updatedAt}` : null;
  const ask = useRead(key, (signal) => sdk.threads.interactions.list({ threadId: thread.id, signal }).then(askOf));
  return ask ?? null;
}
