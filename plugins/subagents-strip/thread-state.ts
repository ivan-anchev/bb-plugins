import { useCallback, useSyncExternalStore } from "react";

type ThreadState<T> = {
  /** The thread's value; `initial` when none is kept. */
  get(threadId: string): T;
  /** Keeps the value as the thread's newest, evicting the least recently set thread past `keep`. */
  set(threadId: string, value: T): void;
  subscribe(listener: () => void): () => void;
};

export function threadState<T>(initial: T, keep: number): ThreadState<T> {
  const values = new Map<string, T>();
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
