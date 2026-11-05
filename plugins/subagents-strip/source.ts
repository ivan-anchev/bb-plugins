// One live, ref-counted source of delegates per thread, shared by every
// component in the window. It reads bb through the browser SDK with the user's
// session; there is no plugin server.
import { useCallback, useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { ThreadSdk } from "./bb.ts";
import type { ThreadDelegates } from "./delegate.ts";
import { createThreadSource, type ThreadSource } from "./thread-source.ts";

/** The thread's delegates, live. A disabled caller holds no subscription and reads "loading". */
export function useThreadDelegates(threadId: string, { enabled = true }: { enabled?: boolean } = {}): ThreadDelegates {
  const sdk = useSdk();
  const subscribe = useCallback(
    (onChange: () => void) => (enabled ? acquire(sdk, threadId).subscribe(onChange) : () => {}),
    [sdk, threadId, enabled],
  );
  const snapshot = useCallback(() => (enabled ? (sources.get(threadId)?.snapshot ?? LOADING) : LOADING), [threadId, enabled]);
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
