// What the user typed and hasn't saved or sent, kept in the browser rather than in a component.
// bb remounts the panel when it redraws it (a resize across its mobile breakpoint does), which
// drops every component's state; web storage outlives that, and a reload. Each value is read
// through its schema, since the browser keeps whatever was written, by any version of the plugin.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { z } from "zod";

/** A value kept under a key: what is there now, and how to replace it (null removes it). */
type Stored<T> = {
  value: T | null;
  store(next: T | null): void;
  /** Replaces the value with what `change` makes of the value stored now, which may be another tab's. */
  update(change: (current: T | null) => T | null): void;
};

/** The value under `key`; null when nothing is stored, or what is can't be read as one. */
function readStored<T>(storage: Pick<Storage, "getItem">, key: string, schema: z.ZodType<T>): T | null {
  return parsed(storage.getItem(key), schema);
}

/** Puts `value` under `key`, or removes the key for null. */
export function writeStored<T>(storage: Pick<Storage, "setItem" | "removeItem">, key: string, value: T | null): void {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(value));
}

/**
 * The value under `key` in `storage`, kept live: every component reading the key re-renders when
 * one stores it, in this tab or another. `schema` must be a module constant.
 */
export function useStored<T>(storage: Storage, key: string, schema: z.ZodType<T>): Stored<T> {
  // why the raw string: it compares by value, so a read that finds the same value renders nothing.
  const raw = useSyncExternalStore(subscribe, () => storage.getItem(key));
  const value = useMemo(() => parsed(raw, schema), [raw, schema]);
  // why stable: an effect that stores can name them as its dependencies.
  const store = useCallback(
    (next: T | null) => {
      writeStored(storage, key, next);
      for (const listener of listeners) listener();
    },
    [storage, key],
  );
  const update = useCallback((change: (current: T | null) => T | null) => store(change(readStored(storage, key, schema))), [store, storage, key, schema]);
  return { value, store, update };
}

function parsed<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (raw === null) return null;
  try {
    const value = schema.safeParse(JSON.parse(raw));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}

// why both: a write in this tab fires no storage event here, only in the other tabs.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
