// One live, ref-counted source of delegates per thread, shared by every
// component in the window. It reads bb through the browser SDK with the user's
// session; there is no plugin server.
import { useCallback, useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { ThreadSdk } from "./bb.ts";
import type { ThreadDelegates } from "./delegate.ts";
import { createThreadSource, type ThreadSource } from "./thread-source.ts";

/**
 * The thread's delegates, live. A disabled caller holds no subscription and
 * is not re-rendered by changes, but still reads the shared source's latest
 * snapshot when it renders ("loading" once no one holds the source). So a
 * panel tab being hidden keeps what it drew, scroll position and open blocks
 * included, instead of dropping to a loading state.
 */
export function useThreadDelegates(threadId: string, { enabled = true }: { enabled?: boolean } = {}): ThreadDelegates {
  const sdk = useSdk();
  const subscribe = useCallback(
    (onChange: () => void) => (enabled ? acquire(sdk, threadId).subscribe(onChange) : () => {}),
    [sdk, threadId, enabled],
  );
  const snapshot = useCallback(() => sources.get(threadId)?.snapshot ?? LOADING, [threadId]);
  return useSyncExternalStore(subscribe, snapshot);
}

// ---------------------------------------------------------------- registry (layer 2)

const sources = new Map<string, ThreadSource>();
const LOADING: ThreadDelegates = { status: "loading" };

function acquire(sdk: ThreadSdk, threadId: string): ThreadSource {
  let source = sources.get(threadId);
  if (!source) {
    source = createThreadSource(sdk, threadId, () => sources.delete(threadId));
    sources.set(threadId, source);
  }
  return source;
}
