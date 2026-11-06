// UI state that outlives the component showing it: one value per thread,
// shared by every component in the window that reads it. bb unmounts a panel
// tab while another tab is selected, so state the tab kept itself would reset.
//
// Who owns it, and for how long: the store keeps the threads whose value was
// set most recently, `keep` of them, and drops the oldest past that. Reading
// never counts, so a tab switch, a remount, or a thread visited without a
// click keeps or evicts nothing; a thread only falls out once `keep` other
// threads have been clicked in since. Its tab then starts from its defaults,
// which is what a reload does anyway. A tab closing is not a signal the store
// can see (bb unmounts a hidden tab the same way), so recency is the bound.
import { useCallback, useSyncExternalStore } from "react";

type ThreadState<T> = {
  /** The thread's value; `initial` when none is kept. */
  get(threadId: string): T;
  /** Keeps the value as the thread's newest, evicting the least recently set thread past `keep`. */
  set(threadId: string, value: T): void;
  subscribe(listener: () => void): () => void;
};

export function threadState<T>(initial: T, keep: number): ThreadState<T> {
  const values = new Map<string, T>(); // insertion order is set order, oldest first
  const listeners = new Set<() => void>();
  return {
    get: (threadId) => values.get(threadId) ?? initial,
    set(threadId, value) {
      values.delete(threadId);
      values.set(threadId, value);
      for (const oldest of values.keys()) {
        if (values.size <= keep) break;
        values.delete(oldest);
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The thread's value in a store, live: the component re-renders when it is set. */
export function useThreadState<T>(store: ThreadState<T>, threadId: string): T {
  const snapshot = useCallback(() => store.get(threadId), [store, threadId]);
  return useSyncExternalStore(store.subscribe, snapshot);
}
